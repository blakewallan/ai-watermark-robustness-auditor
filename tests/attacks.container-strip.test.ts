import { describe, it, expect } from "vitest";
import {
  stripC2paUuidBoxes,
  C2PA_UUID,
} from "../src/attacks/container-strip-c2pa.js";

/**
 * Hand-build a minimal ISOBMFF-shaped buffer so we can test the strip
 * logic without a fixture on disk. We do NOT need a valid media file —
 * the strip logic only cares about top-level box structure.
 */

function box32(type: string, payload: Uint8Array): Buffer {
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
  return box32("uuid", inner);
}

function box64(type: string, payload: Uint8Array): Buffer {
  // Extended-size box: size=1 + type + 8-byte largesize + payload.
  const size = 16 + payload.length;
  const out = Buffer.alloc(size);
  out.writeUInt32BE(1, 0);
  out.write(type, 4, "ascii");
  out.writeBigUInt64BE(BigInt(size), 8);
  out.set(payload, 16);
  return out;
}

function ftyp(): Buffer {
  // `isom` major brand, minor version 0, compatible brands: isom, mp42
  const payload = Buffer.concat([
    Buffer.from("isom", "ascii"),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from("isom", "ascii"),
    Buffer.from("mp42", "ascii"),
  ]);
  return box32("ftyp", payload);
}

const OTHER_UUID = Uint8Array.from([
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
  0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
]);

describe("stripC2paUuidBoxes", () => {
  it("returns stripped=-1 on a non-ISOBMFF blob", () => {
    const input = Buffer.from("hello this is not mp4");
    const { stripped } = stripC2paUuidBoxes(input);
    expect(stripped).toBe(-1);
  });

  it("returns stripped=0 when there are no C2PA boxes", () => {
    const input = Buffer.concat([
      ftyp(),
      box32("mdat", Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])),
    ]);
    const { bytes, stripped } = stripC2paUuidBoxes(input);
    expect(stripped).toBe(0);
    expect(bytes.equals(input)).toBe(true);
  });

  it("rewrites a single C2PA uuid box to free, size-preserving", () => {
    const c2paPayload = Buffer.from("JUMBF_WOULD_GO_HERE_12345678");
    const c2pa = uuidBox(C2PA_UUID, c2paPayload);
    const input = Buffer.concat([
      ftyp(),
      c2pa,
      box32("mdat", Buffer.from([1, 2, 3, 4])),
    ]);
    const originalLength = input.length;
    const c2paStart = ftyp().length;
    const c2paEnd = c2paStart + c2pa.length;

    const { bytes, stripped } = stripC2paUuidBoxes(input);

    expect(stripped).toBe(1);
    expect(bytes.length).toBe(originalLength);

    // Size field unchanged; type rewritten to "free".
    expect(bytes.readUInt32BE(c2paStart)).toBe(c2pa.length);
    expect(bytes.toString("ascii", c2paStart + 4, c2paStart + 8)).toBe("free");

    // UUID and payload zeroed.
    for (let i = c2paStart + 8; i < c2paEnd; i++) {
      expect(bytes[i]).toBe(0);
    }

    // mdat that followed is byte-identical.
    const mdatStart = c2paEnd;
    expect(bytes.toString("ascii", mdatStart + 4, mdatStart + 8)).toBe("mdat");
    expect(bytes.slice(mdatStart + 8, mdatStart + 12)).toEqual(
      Buffer.from([1, 2, 3, 4]),
    );
  });

  it("ignores non-C2PA uuid boxes", () => {
    const benign = uuidBox(OTHER_UUID, Buffer.from("some xmp or pssh goes here"));
    const input = Buffer.concat([ftyp(), benign]);
    const { bytes, stripped } = stripC2paUuidBoxes(input);
    expect(stripped).toBe(0);
    expect(bytes.equals(input)).toBe(true);
  });

  it("strips multiple C2PA boxes in a single pass", () => {
    const p1 = Buffer.from("first_payload_xxxxxxxx");
    const p2 = Buffer.from("second_payload_yyyy");
    const input = Buffer.concat([
      ftyp(),
      uuidBox(C2PA_UUID, p1),
      box32("mdat", Buffer.from([9, 9, 9, 9])),
      uuidBox(C2PA_UUID, p2),
    ]);
    const { bytes, stripped } = stripC2paUuidBoxes(input);
    expect(stripped).toBe(2);
    // Output contains no "uuid" box type at top level any more.
    const topLevelTypes: string[] = [];
    let off = 0;
    while (off < bytes.length) {
      const size = bytes.readUInt32BE(off);
      topLevelTypes.push(bytes.toString("ascii", off + 4, off + 8));
      if (size === 0) break;
      off += size;
    }
    expect(topLevelTypes).toContain("ftyp");
    expect(topLevelTypes).toContain("mdat");
    expect(topLevelTypes.filter((t) => t === "free").length).toBe(2);
    expect(topLevelTypes).not.toContain("uuid");
  });

  it("preserves extended 64-bit uuid boxes as 64-bit free boxes", () => {
    // Use a box just big enough to warrant extended-size encoding by
    // forcing size=1 in the header. (Real MP4s use this when a box is
    // > 4 GiB; here we just exercise the code path.)
    const c2pa = box64(
      "uuid",
      Buffer.concat([C2PA_UUID, Buffer.from("big_payload_zzzzzz")]),
    );
    const input = Buffer.concat([ftyp(), c2pa]);
    const { bytes, stripped } = stripC2paUuidBoxes(input);
    expect(stripped).toBe(1);

    const c2paStart = ftyp().length;
    // size field still 1 (sentinel for "use largesize"); type is now "free";
    // largesize is preserved.
    expect(bytes.readUInt32BE(c2paStart)).toBe(1);
    expect(bytes.toString("ascii", c2paStart + 4, c2paStart + 8)).toBe("free");
    expect(Number(bytes.readBigUInt64BE(c2paStart + 8))).toBe(c2pa.length);
    // UUID and payload zeroed.
    for (let i = c2paStart + 16; i < c2paStart + c2pa.length; i++) {
      expect(bytes[i]).toBe(0);
    }
  });

  it("does not mutate the caller's input buffer", () => {
    const p = Buffer.from("original_payload_xxxxxx");
    const c2pa = uuidBox(C2PA_UUID, p);
    const input = Buffer.concat([ftyp(), c2pa]);
    const snapshot = Buffer.from(input);

    const { bytes, stripped } = stripC2paUuidBoxes(input);
    expect(stripped).toBe(1);
    // Caller's buffer unchanged.
    expect(input.equals(snapshot)).toBe(true);
    // Returned buffer is different (the strip wrote into a copy).
    expect(bytes.equals(input)).toBe(false);
  });
});
