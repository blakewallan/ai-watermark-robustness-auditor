import { describe, it, expect } from "vitest";
import {
  stripXmpPackets,
  XMP_UUID,
  C2PA_UUID,
} from "../src/index.js";

/**
 * All fixtures are hand-built byte buffers. We intentionally do NOT
 * produce decodable media — the strip logic operates purely on container
 * structure, not on sample contents, so a structurally-valid header with
 * a dummy payload is sufficient and keeps the tests fast.
 */

// --- JPEG helpers -----------------------------------------------------------

const SOI = Buffer.from([0xff, 0xd8]);
const EOI = Buffer.from([0xff, 0xd9]);
const SOS = Buffer.from([0xff, 0xda]);

function jpegSegment(marker: number, body: Buffer): Buffer {
  // Segment layout: FF <marker> <2-byte length including the length field> <body>
  const segLen = 2 + body.length;
  const out = Buffer.alloc(4 + body.length);
  out[0] = 0xff;
  out[1] = marker;
  out.writeUInt16BE(segLen, 2);
  body.copy(out, 4);
  return out;
}

function app0Jfif(): Buffer {
  // Minimal JFIF APP0 segment: "JFIF\0" then 5 zero-filled bytes of header.
  return jpegSegment(
    0xe0,
    Buffer.concat([
      Buffer.from("JFIF\0", "latin1"),
      Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0]),
    ]),
  );
}

function app1Xmp(xmpPayload: string): Buffer {
  return jpegSegment(
    0xe1,
    Buffer.concat([
      Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1"),
      Buffer.from(xmpPayload, "utf-8"),
    ]),
  );
}

function app1ExtendedXmp(payload: string): Buffer {
  return jpegSegment(
    0xe1,
    Buffer.concat([
      Buffer.from("http://ns.adobe.com/xmp/extension/\0", "latin1"),
      Buffer.from(payload, "utf-8"),
    ]),
  );
}

function app1Exif(): Buffer {
  // Benign APP1 — Exif, not XMP — to confirm we do not touch it.
  return jpegSegment(
    0xe1,
    Buffer.concat([
      Buffer.from("Exif\0\0", "latin1"),
      Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00]),
    ]),
  );
}

function minimalScan(): Buffer {
  // SOS + 2-byte length + 6-byte SOS body + two bytes of "scan data" + EOI.
  return Buffer.concat([
    SOS,
    Buffer.from([0x00, 0x08]), // segLen for SOS body
    Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]), // SOS body
    Buffer.from([0xaa, 0xbb]), // scan bytes (placeholder)
    EOI,
  ]);
}

// --- ISOBMFF helpers --------------------------------------------------------

function isoBox(type: string, payload: Uint8Array): Buffer {
  const size = 8 + payload.length;
  const out = Buffer.alloc(size);
  out.writeUInt32BE(size, 0);
  out.write(type, 4, "ascii");
  out.set(payload, 8);
  return out;
}

function uuidBox(uuid: Uint8Array, payload: Uint8Array): Buffer {
  const inner = Buffer.alloc(16 + payload.length);
  inner.set(uuid, 0);
  inner.set(payload, 16);
  return isoBox("uuid", inner);
}

function ftyp(): Buffer {
  return isoBox(
    "ftyp",
    Buffer.concat([
      Buffer.from("isom", "ascii"),
      Buffer.from([0, 0, 0, 0]),
      Buffer.from("isom", "ascii"),
      Buffer.from("mp42", "ascii"),
    ]),
  );
}

// --- PNG helpers ------------------------------------------------------------

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngChunk(type: string, data: Buffer): Buffer {
  // Length (4) + type (4) + data + CRC (4). We use a placeholder CRC since
  // the strip logic does not validate it.
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(0xdeadbeef, 8 + data.length);
  return out;
}

function pngXmpItxt(xmp: string): Buffer {
  // iTXt: keyword NUL + compressionFlag(0) + compressionMethod(0) +
  // languageTag NUL + translatedKeyword NUL + text.
  const body = Buffer.concat([
    Buffer.from("XML:com.adobe.xmp\0", "latin1"),
    Buffer.from([0x00, 0x00]), // uncompressed
    Buffer.from("\0", "latin1"), // empty language tag
    Buffer.from("\0", "latin1"), // empty translated keyword
    Buffer.from(xmp, "utf-8"),
  ]);
  return pngChunk("iTXt", body);
}

// ----------------------------------------------------------------------------

describe("stripXmpPackets — format sniffing", () => {
  it("returns format=unknown and stripped=-1 on arbitrary bytes", () => {
    const r = stripXmpPackets(Buffer.from("not a supported container"));
    expect(r.format).toBe("unknown");
    expect(r.stripped).toBe(-1);
  });

  it("returns format=unknown on a buffer shorter than any signature", () => {
    const r = stripXmpPackets(Buffer.from([0xff]));
    expect(r.format).toBe("unknown");
  });
});

describe("stripXmpPackets — JPEG", () => {
  const scan = minimalScan();

  it("splices out a single XMP APP1 segment", () => {
    const xmp = app1Xmp("<x:xmpmeta>dummy</x:xmpmeta>");
    const input = Buffer.concat([SOI, app0Jfif(), xmp, scan]);
    const r = stripXmpPackets(input);
    expect(r.format).toBe("jpeg");
    expect(r.stripped).toBe(1);
    expect(r.bytes.length).toBe(input.length - xmp.length);
    // The output must still start with SOI and contain the SOS scan data.
    expect(r.bytes.slice(0, 2).equals(SOI)).toBe(true);
    expect(r.bytes.includes(Buffer.from([0xff, 0xda]))).toBe(true);
    // The XMP namespace bytes are gone entirely.
    expect(
      r.bytes.includes(Buffer.from("http://ns.adobe.com/xap/1.0/", "latin1")),
    ).toBe(false);
  });

  it("removes both XMP and Extended XMP APP1 segments in one pass", () => {
    const main = app1Xmp("<x:xmpmeta/>");
    const ext = app1ExtendedXmp("...payload for > 64KB XMP...");
    const input = Buffer.concat([SOI, app0Jfif(), main, ext, scan]);
    const r = stripXmpPackets(input);
    expect(r.stripped).toBe(2);
    expect(
      r.bytes.includes(Buffer.from("ns.adobe.com/xap", "latin1")),
    ).toBe(false);
    expect(
      r.bytes.includes(Buffer.from("ns.adobe.com/xmp/extension", "latin1")),
    ).toBe(false);
  });

  it("does not touch benign APP1 segments (Exif)", () => {
    const exif = app1Exif();
    const input = Buffer.concat([SOI, app0Jfif(), exif, scan]);
    const r = stripXmpPackets(input);
    expect(r.stripped).toBe(0);
    // Output must equal input byte-for-byte when nothing was stripped.
    expect(r.bytes.equals(input)).toBe(true);
  });

  it("does not rescan compressed scan data past SOS for marker matches", () => {
    // If our walker wandered past SOS it would mis-parse the 0xFF/0xE1
    // byte sequences embedded in the scan bytes and potentially splice
    // entropy-coded data. We inject a fake FF E1 *inside* the scan and
    // assert the result is byte-identical to the input.
    const compressed = Buffer.from([
      0xaa, 0xbb, 0xff, 0xe1, 0x00, 0x06, 0xde, 0xad,
    ]);
    const input = Buffer.concat([
      SOI,
      app0Jfif(),
      SOS,
      Buffer.from([0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
      compressed,
      EOI,
    ]);
    const r = stripXmpPackets(input);
    expect(r.stripped).toBe(0);
    expect(r.bytes.equals(input)).toBe(true);
  });

  it("stops walking cleanly on a truncated segment rather than throwing", () => {
    // JPEG starts fine but the APP1 length field claims a body longer than
    // the remaining buffer. We must not walk off the end or throw.
    const truncated = Buffer.concat([
      SOI,
      Buffer.from([0xff, 0xe1, 0x00, 0xff]), // APP1 with seg-length 255 but no body
      Buffer.from([0x00]),
    ]);
    const r = stripXmpPackets(truncated);
    expect(r.format).toBe("jpeg");
    expect(r.stripped).toBe(0);
    expect(r.bytes.equals(truncated)).toBe(true);
  });

  it("does not mutate the caller's input buffer", () => {
    const xmp = app1Xmp("<x:xmpmeta/>");
    const input = Buffer.concat([SOI, app0Jfif(), xmp, scan]);
    const snapshot = Buffer.from(input);
    const r = stripXmpPackets(input);
    expect(r.stripped).toBe(1);
    expect(input.equals(snapshot)).toBe(true);
  });
});

describe("stripXmpPackets — ISOBMFF", () => {
  it("rewrites an XMP uuid box to free, size-preserving", () => {
    const xmpPayload = Buffer.from("<?xpacket begin=...?>dummy", "utf-8");
    const xmp = uuidBox(XMP_UUID, xmpPayload);
    const input = Buffer.concat([
      ftyp(),
      xmp,
      isoBox("mdat", Buffer.from([1, 2, 3, 4])),
    ]);
    const xmpStart = ftyp().length;
    const xmpEnd = xmpStart + xmp.length;

    const r = stripXmpPackets(input);
    expect(r.format).toBe("isobmff");
    expect(r.stripped).toBe(1);
    expect(r.bytes.length).toBe(input.length);

    // Type flipped to "free", size preserved, UUID + payload zeroed.
    expect(r.bytes.readUInt32BE(xmpStart)).toBe(xmp.length);
    expect(r.bytes.toString("ascii", xmpStart + 4, xmpStart + 8)).toBe("free");
    for (let i = xmpStart + 8; i < xmpEnd; i++) {
      expect(r.bytes[i]).toBe(0);
    }

    // mdat after is byte-identical.
    const mdatStart = xmpEnd;
    expect(r.bytes.toString("ascii", mdatStart + 4, mdatStart + 8)).toBe("mdat");
  });

  it("leaves a C2PA uuid box intact while stripping the XMP uuid box", () => {
    // This is the headline guarantee — symmetry with container.strip.c2pa.
    const c2pa = uuidBox(C2PA_UUID, Buffer.from("MANIFEST_BYTES_123456"));
    const xmp = uuidBox(XMP_UUID, Buffer.from("<?xpacket begin=...?>"));
    const input = Buffer.concat([
      ftyp(),
      c2pa,
      xmp,
      isoBox("mdat", Buffer.from([9, 9, 9, 9])),
    ]);

    const r = stripXmpPackets(input);
    expect(r.stripped).toBe(1);

    // Walk the output and enumerate top-level box types / uuids.
    const topLevel: Array<{ type: string; uuid?: string }> = [];
    let off = 0;
    while (off < r.bytes.length) {
      const size = r.bytes.readUInt32BE(off);
      const type = r.bytes.toString("ascii", off + 4, off + 8);
      const entry: { type: string; uuid?: string } = { type };
      if (type === "uuid") {
        entry.uuid = r.bytes.slice(off + 8, off + 24).toString("hex");
      }
      topLevel.push(entry);
      if (size === 0) break;
      off += size;
    }

    // The C2PA uuid survives.
    const surviving = topLevel.find(
      (b) => b.type === "uuid" && b.uuid === Buffer.from(C2PA_UUID).toString("hex"),
    );
    expect(surviving).toBeDefined();
    // No uuid box with the XMP UUID remains.
    expect(
      topLevel.find(
        (b) => b.type === "uuid" && b.uuid === Buffer.from(XMP_UUID).toString("hex"),
      ),
    ).toBeUndefined();
  });

  it("returns stripped=0 on an ISOBMFF file with no XMP box", () => {
    const input = Buffer.concat([
      ftyp(),
      isoBox("mdat", Buffer.from([1, 2, 3, 4])),
    ]);
    const r = stripXmpPackets(input);
    expect(r.format).toBe("isobmff");
    expect(r.stripped).toBe(0);
    expect(r.bytes.equals(input)).toBe(true);
  });

  it("ignores non-XMP uuid boxes", () => {
    const otherUuid = Uint8Array.from([
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
      0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
    ]);
    const other = uuidBox(otherUuid, Buffer.from("not-xmp"));
    const input = Buffer.concat([ftyp(), other]);
    const r = stripXmpPackets(input);
    expect(r.stripped).toBe(0);
    expect(r.bytes.equals(input)).toBe(true);
  });
});

describe("stripXmpPackets — PNG", () => {
  function minimalPng(chunks: Buffer[]): Buffer {
    return Buffer.concat([
      PNG_SIG,
      pngChunk(
        "IHDR",
        Buffer.concat([
          Buffer.from([0x00, 0x00, 0x00, 0x01]), // width = 1
          Buffer.from([0x00, 0x00, 0x00, 0x01]), // height = 1
          Buffer.from([0x08, 0x02, 0x00, 0x00, 0x00]), // 8-bit RGB, no filter
        ]),
      ),
      ...chunks,
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
  }

  it("splices out an iTXt chunk keyed XML:com.adobe.xmp", () => {
    const xmp = pngXmpItxt("<x:xmpmeta>dummy</x:xmpmeta>");
    const benign = pngChunk(
      "tEXt",
      Buffer.from("Software\0imagemagick", "latin1"),
    );
    const input = minimalPng([xmp, benign]);

    const r = stripXmpPackets(input);
    expect(r.format).toBe("png");
    expect(r.stripped).toBe(1);
    expect(r.bytes.length).toBe(input.length - xmp.length);

    // Benign tEXt chunk still there.
    expect(r.bytes.includes(Buffer.from("imagemagick", "latin1"))).toBe(true);
    // XMP keyword gone.
    expect(
      r.bytes.includes(Buffer.from("XML:com.adobe.xmp", "latin1")),
    ).toBe(false);
    // Still a valid PNG signature and ends with IEND.
    expect(r.bytes.slice(0, 8).equals(PNG_SIG)).toBe(true);
    expect(r.bytes.slice(-8, -4).toString("ascii")).toBe("IEND");
  });

  it("ignores iTXt chunks with other keywords", () => {
    const description = pngChunk(
      "iTXt",
      Buffer.concat([
        Buffer.from("Description\0", "latin1"),
        Buffer.from([0x00, 0x00]),
        Buffer.from("\0\0", "latin1"),
        Buffer.from("a photograph", "utf-8"),
      ]),
    );
    const input = minimalPng([description]);
    const r = stripXmpPackets(input);
    expect(r.stripped).toBe(0);
    expect(r.bytes.equals(input)).toBe(true);
  });

  it("returns stripped=0 on a PNG with no XMP", () => {
    const input = minimalPng([]);
    const r = stripXmpPackets(input);
    expect(r.format).toBe("png");
    expect(r.stripped).toBe(0);
    expect(r.bytes.equals(input)).toBe(true);
  });
});
