import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { Attack, AttackContext, AttackResult } from "./types.js";
import type { CorpusItem } from "../types.js";
import { AttackError } from "./shared.js";

/**
 * Container-level XMP strip attack.
 *
 * The symmetric counterpart to `container.strip.c2pa`: a surgical byte-level
 * attack that removes every embedded XMP packet while leaving every other
 * byte of the asset — including a C2PA `uuid` box, if present — untouched.
 * No re-encode; the bitstream passes through.
 *
 * Why this attack exists
 * ----------------------
 *
 * The robustness auditor's headline finding to date is that
 * `container.strip.c2pa` destroys a signed C2PA manifest but leaves an
 * unsigned IPTC XMP `DigitalSourceType` URI intact. The obvious response —
 * and the first thing a reviewer will ask — is: "and is the reverse also
 * true?" If the two disclosure mechanisms have disjoint failure modes, a
 * mirror attack should destroy XMP while leaving C2PA intact. This module
 * provides that mirror, so the two-detector × four-attack matrix contains
 * an explicit cell demonstrating each direction of the asymmetry.
 *
 * Unlike `container.strip.c2pa`, whose threat model is an adversary
 * laundering an AI-generated clip, this attack is less about adversarial
 * behaviour and more about platform-side data loss: many media pipelines
 * aggressively strip XMP metadata on upload (TikTok, WhatsApp, Twitter/X
 * image previews), and the resulting file is byte-shape-identical to what
 * this attack produces. A watermark / disclosure scheme that relies on XMP
 * for its machine-readable signal has to survive this transformation or
 * accept that the signal is effectively nonexistent on those platforms.
 *
 * Mechanism
 * ---------
 *
 * Dispatches on container format:
 *
 *   - **JPEG**: walks segment markers from SOI (FF D8) forward. Every APP1
 *     segment (FF E1) whose body begins with the XMP namespace
 *     `http://ns.adobe.com/xap/1.0/\0` or the Extended XMP namespace
 *     `http://ns.adobe.com/xmp/extension/\0` is removed by splicing the
 *     full segment (marker + 2-byte length + body) out of the byte stream.
 *     JPEG has no absolute-offset references, so splicing is safe and
 *     produces a smaller, fully-decodable JPEG.
 *
 *   - **ISOBMFF** (MP4 / MOV / M4A / HEIF): walks top-level boxes. Every
 *     `uuid` box whose UUID equals the registered XMP UUID
 *     `BE7ACFCB-97A9-42E8-9C71-999491E3AFAC` (XMP Spec Part 3 §1.1.3) is
 *     rewritten in place to a `free` box with UUID and payload zeroed.
 *     Size is preserved exactly, matching the strategy used by
 *     `container.strip.c2pa`, so `stco` / `co64` sample-table offsets
 *     inside `moov` remain correct and playback is bit-identical.
 *
 *   - **PNG**: walks chunks after the 8-byte signature. Every `iTXt`
 *     chunk whose keyword is `XML:com.adobe.xmp` (the normative keyword
 *     per XMP Spec Part 3 §1.1.4) is spliced out whole — length field,
 *     type, data, and CRC — since PNG chunks are self-contained and have
 *     no chain CRC.
 *
 * All other container formats (WebP, OGG, TIFF, …) currently surface as
 * AttackError so the runner records them as inapplicable rather than
 * silently pretending the attack succeeded. Extending to those formats
 * is mechanical; no current corpus item exercises them.
 *
 * Interaction with C2PA hard-binding
 * ----------------------------------
 *
 * When a C2PA manifest was signed *after* XMP injection (the case for the
 * bundled `corpus/synth-xmp/` items), the data-hash assertion covers the
 * bytes that include the XMP packet. This attack consequently breaks the
 * hard-binding hash — but crucially, the manifest box itself is untouched,
 * so `detector.c2pa` still reports `detected=true` at confidence 0.5
 * ("manifest present but has errors"). 0.5 is the methodology's survival
 * threshold, so the C2PA cell *survives* this attack. That is the
 * publishable signal: stripping XMP does not remove the C2PA claim, it
 * just invalidates the hash — and validator policy decides whether to
 * trust the resulting "present but broken" manifest.
 *
 * References:
 *   - XMP Spec Part 3 §1.1.2 (Adobe): JPEG / APP1 embedding
 *   - XMP Spec Part 3 §1.1.3 (Adobe): ISOBMFF / uuid embedding
 *   - XMP Spec Part 3 §1.1.4 (Adobe): PNG / iTXt embedding
 *   - ISO/IEC 14496-12 §8.4 (ISOBMFF box structure)
 *   - ITU-T T.81 / JPEG (segment marker layout)
 *   - ISO/IEC 15948 / PNG (chunk layout and CRC)
 *
 * See METHODOLOGY.md §A5.
 */
export const containerStripXmp: Attack = {
  id: "container.strip.xmp",
  category: "container",
  title: "Strip XMP packets (size-preserving where required)",
  description:
    "Surgical byte-level attack. Removes every embedded XMP packet from " +
    "the asset — JPEG APP1 segments with the XMP namespace, ISOBMFF uuid " +
    "boxes with the XMP UUID, PNG iTXt chunks keyed XML:com.adobe.xmp — " +
    "without re-encoding and without disturbing any non-XMP metadata. A " +
    "present C2PA manifest passes through structurally intact (though its " +
    "hard-binding hash no longer matches).",
  methodologyRef: "METHODOLOGY.md#A5",

  async run(input: CorpusItem, ctx: AttackContext): Promise<AttackResult> {
    const started = performance.now();
    const outputPath = path.join(
      ctx.workDir,
      `${input.id}__${this.id}${path.extname(input.path) || ".bin"}`,
    );

    const original = await readFile(input.path);
    const result = stripXmpPackets(original);

    if (result.format === "unknown") {
      throw new AttackError(
        `Input ${input.id} is not a container format this attack supports ` +
          `(JPEG, ISOBMFF, PNG). Add support or mark the item as inapplicable.`,
        "",
      );
    }

    await writeFile(outputPath, result.bytes);

    return {
      attackId: this.id,
      inputId: input.id,
      outputPath,
      durationMs: Math.round(performance.now() - started),
      stderrTail: `format=${result.format}  stripped ${result.stripped} XMP packet(s)`,
    };
  },
};

/**
 * Registered XMP UUID for ISOBMFF embedding.
 *
 *   BE7A CFCB 97A9 42E8 9C71 9994 91E3 AFAC
 *
 * From XMP Specification Part 3 §1.1.3. This is the same UUID all XMP
 * writers (exiftool, Adobe tooling, c2patool) use for XMP-in-ISOBMFF.
 */
export const XMP_UUID = Uint8Array.from([
  0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8,
  0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac,
]);

/** Standard XMP namespace marker in JPEG APP1 segments. 29 bytes, NUL-terminated. */
const JPEG_XMP_NS = Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1");
/** Extended XMP namespace marker for multi-APP1-segment XMP payloads >64 KB. */
const JPEG_XMP_EXT_NS = Buffer.from(
  "http://ns.adobe.com/xmp/extension/\0",
  "latin1",
);

/** PNG 8-byte signature. */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Normative PNG iTXt keyword for XMP packets (XMP Spec Part 3 §1.1.4). */
const PNG_XMP_KEYWORD = Buffer.from("XML:com.adobe.xmp", "latin1");

const ISO_TYPE_UUID = Buffer.from("uuid", "latin1");
const ISO_TYPE_FREE = Buffer.from("free", "latin1");

export interface XmpStripResult {
  /** Resulting bytes. Fresh buffer; the caller's input is never mutated. */
  readonly bytes: Buffer;
  /**
   * Number of XMP packets removed.
   *   - `>= 0`: successful walk, that many packets stripped (0 is legal —
   *     e.g. an MP4 with no XMP uuid box is a clean no-op).
   *   - `-1`: format not recognised; `bytes` is a verbatim copy of the input.
   */
  readonly stripped: number;
  /** Sniffed container format. `"unknown"` iff `stripped === -1`. */
  readonly format: "jpeg" | "isobmff" | "png" | "unknown";
}

/**
 * Remove every embedded XMP packet from the input bytes.
 *
 * Pure function. Deterministic. No I/O. Unit-tested alongside
 * [`tests/attacks.xmp-strip.test.ts`](../../tests/attacks.xmp-strip.test.ts).
 */
export function stripXmpPackets(input: Uint8Array): XmpStripResult {
  if (isJpeg(input)) return stripJpegXmp(input);
  if (isPng(input)) return stripPngXmp(input);
  if (isIsobmff(input)) return stripIsobmffXmp(input);
  return { bytes: Buffer.from(input), stripped: -1, format: "unknown" };
}

// --- sniffers ---------------------------------------------------------------

function isJpeg(b: Uint8Array): boolean {
  return b.length >= 2 && b[0] === 0xff && b[1] === 0xd8;
}

function isPng(b: Uint8Array): boolean {
  if (b.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (b[i] !== PNG_SIG[i]) return false;
  }
  return true;
}

function isIsobmff(b: Uint8Array): boolean {
  // First top-level box must be a plausible ISOBMFF box. The second 4
  // bytes are the box type ASCII. We accept any valid-looking ASCII type
  // to keep the sniff cheap; the walk below does the strict validation.
  if (b.length < 8) return false;
  for (let i = 4; i < 8; i++) {
    const c = b[i];
    if (c === undefined) return false;
    // Box type chars are printable ASCII (0x20..0x7e). `ftyp` / `free` / etc.
    if (c < 0x20 || c > 0x7e) return false;
  }
  // Size field must be plausible — either 0 (run to EOF), 1 (extended), or
  // at least 8 bytes and not larger than the buffer.
  const size =
    (b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!;
  if (size === 0 || size === 1) return true;
  return size >= 8 && size <= b.length;
}

// --- JPEG -------------------------------------------------------------------

/**
 * Walk JPEG segments; splice out every APP1 segment carrying an XMP or
 * Extended-XMP namespace marker. Stops at the start-of-scan marker (FF DA)
 * because the compressed image data that follows cannot contain metadata
 * segments.
 */
function stripJpegXmp(input: Uint8Array): XmpStripResult {
  const src = Buffer.from(input);
  /** [start, endExclusive] byte ranges to splice out. */
  const cuts: Array<[number, number]> = [];

  let off = 2; // skip SOI (FF D8)
  while (off + 3 < src.length) {
    if (src[off] !== 0xff) break;
    const marker = src[off + 1]!;

    // Markers without a length payload — standalone bytes.
    if (marker === 0xd9 /* EOI */) break;
    if (marker === 0xda /* SOS */) break;

    const segLen = src.readUInt16BE(off + 2);
    const bodyStart = off + 4;
    const bodyEnd = off + 2 + segLen;
    if (bodyEnd > src.length) break; // truncated; stop walking

    if (marker === 0xe1 /* APP1 */) {
      if (bodyStartsWith(src, bodyStart, bodyEnd, JPEG_XMP_NS)) {
        cuts.push([off, bodyEnd]);
      } else if (bodyStartsWith(src, bodyStart, bodyEnd, JPEG_XMP_EXT_NS)) {
        cuts.push([off, bodyEnd]);
      }
    }

    off = bodyEnd;
  }

  if (cuts.length === 0) {
    return { bytes: Buffer.from(src), stripped: 0, format: "jpeg" };
  }

  // Compose the output by copying the complement of `cuts`.
  const parts: Buffer[] = [];
  let cursor = 0;
  for (const [a, b] of cuts) {
    if (a > cursor) parts.push(src.slice(cursor, a));
    cursor = b;
  }
  if (cursor < src.length) parts.push(src.slice(cursor));

  return {
    bytes: Buffer.concat(parts),
    stripped: cuts.length,
    format: "jpeg",
  };
}

function bodyStartsWith(
  buf: Buffer,
  start: number,
  end: number,
  needle: Buffer,
): boolean {
  if (end - start < needle.length) return false;
  for (let i = 0; i < needle.length; i++) {
    if (buf[start + i] !== needle[i]) return false;
  }
  return true;
}

// --- PNG --------------------------------------------------------------------

/**
 * Walk PNG chunks after the 8-byte signature; splice out every `iTXt`
 * chunk whose keyword equals `XML:com.adobe.xmp`. Each chunk is
 * self-contained (length + type + data + CRC), so splicing is safe.
 */
function stripPngXmp(input: Uint8Array): XmpStripResult {
  const src = Buffer.from(input);
  const cuts: Array<[number, number]> = [];

  let off = 8; // skip signature
  while (off + 8 <= src.length) {
    const length = src.readUInt32BE(off);
    const type = src.slice(off + 4, off + 8).toString("latin1");
    const dataStart = off + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4; // + CRC
    if (chunkEnd > src.length) break;

    if (type === "iTXt") {
      // iTXt layout: keyword (NUL-terminated Latin-1), then compression
      // flag, compression method, language tag, translated keyword, text.
      // We only need the keyword.
      let kwEnd = dataStart;
      while (kwEnd < dataEnd && src[kwEnd] !== 0x00) kwEnd++;
      const keyword = src.slice(dataStart, kwEnd);
      if (keyword.equals(PNG_XMP_KEYWORD)) {
        cuts.push([off, chunkEnd]);
      }
    }

    off = chunkEnd;
    if (type === "IEND") break;
  }

  if (cuts.length === 0) {
    return { bytes: Buffer.from(src), stripped: 0, format: "png" };
  }

  const parts: Buffer[] = [];
  let cursor = 0;
  for (const [a, b] of cuts) {
    if (a > cursor) parts.push(src.slice(cursor, a));
    cursor = b;
  }
  if (cursor < src.length) parts.push(src.slice(cursor));

  return {
    bytes: Buffer.concat(parts),
    stripped: cuts.length,
    format: "png",
  };
}

// --- ISOBMFF ----------------------------------------------------------------

/**
 * Walk top-level ISOBMFF boxes; rewrite every XMP uuid box to a `free` box
 * of identical total size (UUID + payload zeroed). Matches the byte-offset-
 * preserving strategy used by `container.strip.c2pa` so `stco` / `co64`
 * sample-table references stay valid even though in practice XMP uuid
 * boxes sit after `moov` and no offset table points into them.
 */
function stripIsobmffXmp(input: Uint8Array): XmpStripResult {
  const bytes = Buffer.from(input);
  let off = 0;
  let stripped = 0;
  let anyValidBox = false;

  while (off < bytes.length) {
    const header = readBoxHeader(bytes, off);
    if (!header) {
      if (!anyValidBox) {
        // Sniff said ISOBMFF but first box is unparseable; treat as unknown
        // so the runner can record the attack as inapplicable rather than
        // lie about a 0-box strip.
        return { bytes: Buffer.from(input), stripped: -1, format: "unknown" };
      }
      break;
    }
    anyValidBox = true;

    if (header.type === "uuid" && header.uuid && uuidEquals(header.uuid, XMP_UUID)) {
      rewriteUuidToFree(bytes, off, header);
      stripped += 1;
    }

    if (header.totalEnd <= off) break;
    off = header.totalEnd;
  }

  return { bytes, stripped, format: "isobmff" };
}

interface BoxHeader {
  type: string;
  typeOffset: number;
  uuidOffset?: number;
  bodyOffset: number;
  totalEnd: number;
  uuid?: Uint8Array;
}

function readBoxHeader(bytes: Uint8Array, offset: number): BoxHeader | null {
  if (offset + 8 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let size = view.getUint32(offset);
  const type = ascii(bytes, offset + 4, 4);
  let bodyOffset = offset + 8;

  if (size === 1) {
    if (offset + 16 > bytes.length) return null;
    const hi = view.getUint32(offset + 8);
    const lo = view.getUint32(offset + 12);
    size = hi * 0x100000000 + lo;
    bodyOffset = offset + 16;
  } else if (size === 0) {
    size = bytes.length - offset;
  }

  if (size < bodyOffset - offset) return null;
  const totalEnd = offset + size;
  if (totalEnd > bytes.length) return null;

  let uuidOffset: number | undefined;
  let uuid: Uint8Array | undefined;
  if (type === "uuid") {
    if (bodyOffset + 16 > bytes.length) return null;
    uuidOffset = bodyOffset;
    uuid = bytes.slice(bodyOffset, bodyOffset + 16);
    bodyOffset += 16;
  }

  const h: BoxHeader = {
    type,
    typeOffset: offset + 4,
    bodyOffset,
    totalEnd,
  };
  if (uuidOffset !== undefined) h.uuidOffset = uuidOffset;
  if (uuid) h.uuid = uuid;
  return h;
}

function rewriteUuidToFree(bytes: Buffer, offset: number, h: BoxHeader): void {
  bytes.set(ISO_TYPE_FREE, h.typeOffset);
  const zeroStart = h.uuidOffset ?? h.bodyOffset;
  if (zeroStart < h.totalEnd) {
    bytes.fill(0, zeroStart, h.totalEnd);
  }
  // Silence unused-import complaint: ISO_TYPE_UUID is kept as documentation
  // of the source type we are rewriting away from, even though the match
  // happens via `header.type === "uuid"` above.
  void ISO_TYPE_UUID;
}

function uuidEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function ascii(bytes: Uint8Array, offset: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) {
    const c = bytes[offset + i];
    if (c === undefined) return s;
    s += String.fromCharCode(c);
  }
  return s;
}
