import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { Attack, AttackContext, AttackResult } from "./types.js";
import type { CorpusItem } from "../types.js";
import { AttackError } from "./shared.js";

/**
 * Container-level C2PA strip attack.
 *
 * Adversarial, byte-level. Does not re-encode — the pixels, audio, and all
 * non-C2PA metadata pass through unchanged. The point of this attack is to
 * measure the claim "C2PA is tamper-evident" against the stronger claim
 * "C2PA is durable" — anyone with a hex editor can do what this does, so
 * any robustness argument that rests on the manifest still being present
 * has to account for this attack existing.
 *
 * Mechanism — size-preserving overwrite:
 *
 *   1. Walk top-level ISOBMFF boxes.
 *   2. For each `uuid` box whose UUID equals the registered C2PA UUID
 *      `D8FEC3D6-1B0E-483C-9297-5828877EC481`, overwrite the box in place:
 *        - type field `"uuid"` → `"free"`
 *        - UUID field and payload → zero bytes
 *   3. The box's `size` field, the `largesize` field (if the box was using
 *      extended 64-bit sizing), and every subsequent byte offset in the
 *      file remain unchanged. This means `stco` / `co64` sample-table
 *      entries inside `moov` still resolve correctly and playback is bit-
 *      exact on the video/audio tracks.
 *
 * C2PA readers look specifically for a uuid box carrying the C2PA UUID;
 * after this rewrite the file appears to have no manifest at all. The
 * original bytes are not recoverable without the pre-attack file.
 *
 * References:
 *   - ISO/IEC 14496-12 §8.4 Box structure (box header layout, extended size)
 *   - ISO/IEC 14496-12 §8.1.2 free / skip boxes
 *   - C2PA 2.0 §9 Embedding in ISOBMFF files (UUID registration)
 *
 * See METHODOLOGY.md §A4.
 */
export const containerStripC2pa: Attack = {
  id: "container.strip.c2pa",
  category: "container",
  title: "Strip C2PA uuid boxes (size-preserving)",
  description:
    "Surgical byte-level attack. Rewrites every ISOBMFF top-level uuid " +
    "box bearing the registered C2PA UUID to a free box of identical total " +
    "size, zeroing the payload. No re-encode; no sample-table offsets " +
    "shift; playback is untouched. The resulting file has no readable C2PA " +
    "manifest and no evidence that one was ever present.",
  methodologyRef: "METHODOLOGY.md#A4",

  async run(input: CorpusItem, ctx: AttackContext): Promise<AttackResult> {
    const started = performance.now();
    const outputPath = path.join(
      ctx.workDir,
      `${input.id}__${this.id}${path.extname(input.path) || ".mp4"}`,
    );

    const original = await readFile(input.path);
    const { bytes, stripped } = stripC2paUuidBoxes(original);

    if (stripped === -1) {
      // Not an ISOBMFF file we understand — surface as AttackError rather
      // than silently copying, so the runner knows the input didn't match
      // the attack's threat model.
      throw new AttackError(
        `Input ${input.id} is not a recognisable ISOBMFF file; ${containerStripC2pa.id} only applies to MP4/MOV/HEIF.`,
        "",
      );
    }

    await writeFile(outputPath, bytes);

    return {
      attackId: this.id,
      inputId: input.id,
      outputPath,
      durationMs: Math.round(performance.now() - started),
      stderrTail: `stripped ${stripped} C2PA uuid box(es)`,
    };
  },
};

/** Registered C2PA UUID for ISOBMFF embedding.
 *
 *   D8FE C3D6 1B0E 483C 9297 5828 877E C481
 */
export const C2PA_UUID = Uint8Array.from([
  0xd8, 0xfe, 0xc3, 0xd6, 0x1b, 0x0e, 0x48, 0x3c,
  0x92, 0x97, 0x58, 0x28, 0x87, 0x7e, 0xc4, 0x81,
]);

const TYPE_UUID = Uint8Array.from([0x75, 0x75, 0x69, 0x64]); // "uuid"
const TYPE_FREE = Uint8Array.from([0x66, 0x72, 0x65, 0x65]); // "free"

export interface StripResult {
  /** The (possibly-modified) file bytes. Allocated as a fresh buffer — the
   *  original input is never mutated. */
  bytes: Buffer;
  /**
   * Number of C2PA uuid boxes stripped.
   *   - ≥ 0: successful walk, that many boxes rewritten to `free`.
   *   - -1: input did not look like ISOBMFF at all (no valid top-level
   *     boxes or truncated at the first header). Caller should treat this
   *     as an inapplicable input rather than a no-op.
   */
  stripped: number;
}

/**
 * Strip every top-level C2PA `uuid` box from an ISOBMFF buffer by
 * rewriting it to a `free` box of identical total length.
 *
 * Pure function — unit-testable without disk I/O.
 *
 * Returns the number of boxes stripped, or -1 if the input is not
 * recognisably ISOBMFF.
 */
export function stripC2paUuidBoxes(input: Uint8Array): StripResult {
  // Defensive copy. We rewrite into this buffer and hand it back; the
  // original caller's buffer is never mutated.
  const bytes = Buffer.from(input);

  if (bytes.length < 8) {
    return { bytes, stripped: -1 };
  }

  let offset = 0;
  let stripped = 0;
  let anyValidBox = false;

  while (offset < bytes.length) {
    const header = readBoxHeader(bytes, offset);
    if (!header) {
      // First unreadable box → not ISOBMFF. After at least one valid box it
      // just means truncated data; stop walking and return what we have.
      if (!anyValidBox) return { bytes, stripped: -1 };
      break;
    }
    anyValidBox = true;

    if (
      header.type === "uuid" &&
      header.uuid &&
      uuidEquals(header.uuid, C2PA_UUID)
    ) {
      rewriteToFree(bytes, offset, header);
      stripped += 1;
    }

    if (header.totalEnd <= offset) {
      // Pathological zero-size box; avoid infinite loop.
      break;
    }
    offset = header.totalEnd;
  }

  return { bytes, stripped };
}

interface BoxHeader {
  type: string;
  /** Offset of the 4-byte type field (offset + 4). */
  typeOffset: number;
  /** Offset where UUID starts (undefined for non-uuid boxes). */
  uuidOffset?: number;
  /** Where the box body (post-header, post-UUID) begins. */
  bodyOffset: number;
  /** Exclusive end offset of the full box. */
  totalEnd: number;
  /** UUID bytes when type === "uuid". */
  uuid?: Uint8Array;
}

function readBoxHeader(bytes: Uint8Array, offset: number): BoxHeader | null {
  if (offset + 8 > bytes.length) return null;

  const view = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
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

  // Unreasonable sizes → give up rather than run off the end.
  if (size < bodyOffset - offset) return null;
  const totalEnd = offset + size;
  if (totalEnd > bytes.length) return null;

  let uuid: Uint8Array | undefined;
  let uuidOffset: number | undefined;
  if (type === "uuid") {
    if (bodyOffset + 16 > bytes.length) return null;
    uuidOffset = bodyOffset;
    uuid = bytes.slice(bodyOffset, bodyOffset + 16);
    bodyOffset += 16;
  }

  const header: BoxHeader = {
    type,
    typeOffset: offset + 4,
    bodyOffset,
    totalEnd,
  };
  if (uuidOffset !== undefined) header.uuidOffset = uuidOffset;
  if (uuid) header.uuid = uuid;
  return header;
}

function rewriteToFree(bytes: Buffer, offset: number, header: BoxHeader): void {
  // Size field (header.typeOffset - offset = 4 bytes) stays intact.
  // Overwrite type "uuid" → "free".
  bytes.set(TYPE_FREE, header.typeOffset);
  // If there was an extended size field (largesize) between type and body,
  // leave it intact — the `free` box remains a valid 64-bit box. Zero
  // everything from the UUID field through the original payload.
  const zeroStart = header.uuidOffset ?? header.bodyOffset;
  if (zeroStart < header.totalEnd) {
    bytes.fill(0, zeroStart, header.totalEnd);
  }
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
