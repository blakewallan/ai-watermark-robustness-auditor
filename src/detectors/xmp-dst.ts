import { readFile } from "node:fs/promises";
import type { Detector, DetectionResult, DetectorContext } from "./types.js";

/**
 * IPTC XMP `DigitalSourceType` detector.
 *
 * The non-C2PA, machine-readable-unsigned AI disclosure path. Many generators
 * and publishing platforms embed an `Iptc4xmpExt:DigitalSourceType` URI in an
 * XMP packet inside the asset instead of (or in addition to) a signed C2PA
 * manifest. The EU AI Act Code of Practice explicitly recognises this IPTC
 * field as a valid disclosure vehicle, so measuring how well it survives
 * transcodes / platform round-trips is independently useful.
 *
 * Detection is a pure byte-level scan of the file for:
 *   1. The XMP envelope magic (`<?xpacket begin=`), and
 *   2. A `(Iptc4xmpExt|iptcExt):DigitalSourceType` attribute or element.
 *
 * XMP is designed so that locating a packet inside any container is safe to
 * do with a linear byte search — the envelope PIs are the official marker
 * (Adobe XMP Spec Part 3 §1). The same scan works for JPEG APP1 segments,
 * PNG iTXt chunks, ISOBMFF uuid boxes, PDF metadata streams, and plain
 * sidecar XMP.
 *
 * We deliberately do not reuse the richer XMP scanner from
 * `c2pa-manifest-validator` as a runtime dependency: the auditor's detector
 * contract is "one file path in, a DetectionResult out," and pulling in the
 * whole validator library for a ~50-line byte scan would couple the two
 * repos more tightly than helpful. The scanner below is deliberately a
 * narrower subset focused on robustness signal, not disclosure-category
 * classification (which rules engines care about and detectors do not).
 *
 * Confidence semantics:
 *   - no XMP packet in the bytes                → detected=false, confidence=0
 *   - XMP packet but no DigitalSourceType field → detected=false, confidence=0
 *   - DigitalSourceType URI present             → detected=true,  confidence=1
 *
 * Unlike C2PA there is no cryptographic integrity check: XMP is unsigned by
 * construction, so the signal is binary (present vs absent). The "which URI
 * exactly" classification is recorded in `evidence` for reviewers but does
 * not affect confidence — a producer who emits a "human-origin"
 * DigitalSourceType and an attacker who rewrites it to `algorithmicMedia`
 * are both still "DST-disclosed" from the detector's perspective; a
 * *rule engine* can then apply policy on top of that raw signal.
 */

/** What the byte scan found. Exported for testing. */
export interface XmpDstScan {
  readonly xmpPresent: boolean;
  readonly packetOffset?: number;
  readonly digitalSourceType?: string;
  /** Coarse bucket for the URI. Informational only; does not affect confidence. */
  readonly classification?:
    | "ai-generated"
    | "ai-modified"
    | "ai-training-data"
    | "human"
    | "unknown";
}

const XPACKET_BEGIN = "<?xpacket begin=";
const DST_ATTR_RE =
  /(?:Iptc4xmpExt|iptcExt):DigitalSourceType\s*=\s*"([^"]+)"/;
const DST_ELEM_RE =
  /<(?:Iptc4xmpExt|iptcExt):DigitalSourceType[^>]*>\s*([^<]+?)\s*<\/(?:Iptc4xmpExt|iptcExt):DigitalSourceType>/;

const IPTC_ROOT = "http://cv.iptc.org/newscodes/digitalsourcetype/";
const C2PA_ROOT = "http://c2pa.org/digitalsourcetype/";

/**
 * Suffixes that indicate "trained neural model produced this media" — the
 * category the EU AI Act Art. 50(2) is actually about. We keep this set
 * narrow and duplicated here (rather than imported from a shared package)
 * so the detector has zero cross-repo dependencies at runtime.
 */
const AI_GENERATED_SUFFIXES = new Set([
  "trainedAlgorithmicMedia",
  "algorithmicMedia",
  "compositeSynthetic",
]);
const AI_MODIFIED_SUFFIXES = new Set([
  "compositeCaptureAndAlgorithmicMedia",
  "compositeWithTrainedAlgorithmicMedia",
  "algorithmicallyEnhanced",
]);
const HUMAN_SUFFIXES = new Set([
  "digitalCapture",
  "negativeFilm",
  "positiveFilm",
  "print",
  "humanEdits",
  "minorHumanEdits",
]);

/**
 * Scan a byte buffer for an XMP DigitalSourceType signal.
 *
 * Pure. Deterministic. No I/O.
 */
export function scanBytesForXmpDst(bytes: Uint8Array): XmpDstScan {
  const buf = Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  );
  const start = buf.indexOf(XPACKET_BEGIN);
  if (start < 0) return { xmpPresent: false };

  // Bound the packet window. We do not require the `<?xpacket end=`
  // sentinel because it may be arbitrarily far away inside large binary
  // containers; the DST attribute in practice appears within the first
  // few KB of the packet. Cap at 64 KB so we do not regex-scan a whole
  // multi-megabyte file.
  const windowEnd = Math.min(buf.length, start + 65_536);
  const windowStr = buf.slice(start, windowEnd).toString("utf-8");

  const uri = (
    DST_ATTR_RE.exec(windowStr)?.[1] ?? DST_ELEM_RE.exec(windowStr)?.[1]
  )?.trim();

  if (!uri) {
    return { xmpPresent: true, packetOffset: start };
  }

  return {
    xmpPresent: true,
    packetOffset: start,
    digitalSourceType: uri,
    classification: classifyUri(uri),
  };
}

type XmpDstClassification = NonNullable<XmpDstScan["classification"]>;

function classifyUri(raw: string): XmpDstClassification {
  const trimmed = raw.trim().replace(/^<|>$/g, "");
  const suffix = suffixOf(trimmed);
  if (suffix === "trainedAlgorithmicData") return "ai-training-data";
  if (AI_GENERATED_SUFFIXES.has(suffix)) return "ai-generated";
  if (AI_MODIFIED_SUFFIXES.has(suffix)) return "ai-modified";
  if (HUMAN_SUFFIXES.has(suffix)) return "human";
  return "unknown";
}

function suffixOf(uri: string): string {
  if (uri.startsWith(IPTC_ROOT)) return uri.slice(IPTC_ROOT.length);
  if (uri.startsWith(C2PA_ROOT)) return uri.slice(C2PA_ROOT.length);
  if (!uri.includes("/")) return uri;
  return uri.split("/").pop() ?? uri;
}

/**
 * Classify a scan into a DetectionResult. Pure function, exported for
 * independent unit testing.
 */
export function classifyXmpScan(scan: XmpDstScan): DetectionResult {
  if (!scan.digitalSourceType) {
    return {
      detectorId: "detector.xmp-dst",
      detected: false,
      confidence: 0,
      evidence: {
        reason: scan.xmpPresent ? "xmp-present-no-dst" : "xmp-absent",
      },
    };
  }

  return {
    detectorId: "detector.xmp-dst",
    detected: true,
    confidence: 1,
    evidence: {
      reason: "dst-present",
      digitalSourceType: scan.digitalSourceType,
      classification: scan.classification ?? "unknown",
      ...(scan.packetOffset !== undefined
        ? { packetOffset: scan.packetOffset }
        : {}),
    },
  };
}

export const xmpDstDetector: Detector = {
  id: "detector.xmp-dst",
  watermarkKind: "iptc-xmp",
  title: "IPTC XMP DigitalSourceType (unsigned)",
  description:
    "Scans the bytes of the asset for an XMP packet containing an " +
    "Iptc4xmpExt:DigitalSourceType URI — the EU AI Act Code-of-Practice-" +
    "recognised AI disclosure metadata field. Detects presence only; " +
    "since XMP has no signature envelope, any visible DST URI counts as " +
    "a surviving disclosure regardless of category.",

  async detect(
    mediaPath: string,
    _ctx: DetectorContext,
  ): Promise<DetectionResult> {
    let bytes: Buffer;
    try {
      bytes = await readFile(mediaPath);
    } catch (err) {
      return {
        detectorId: "detector.xmp-dst",
        detected: false,
        confidence: 0,
        errorMessage: `Could not read ${mediaPath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
    return classifyXmpScan(scanBytesForXmpDst(bytes));
  },
};
