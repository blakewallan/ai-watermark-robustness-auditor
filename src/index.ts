/**
 * Public API surface for `ai-watermark-robustness-auditor`.
 *
 * This file is the only supported import path for downstream consumers. Deep
 * imports into `src/attacks/*` or `src/detectors/*` are not part of the
 * stability contract and may be reorganised between minor versions.
 */

export type {
  AttackCategory,
  CorpusItem,
  RobustnessGrade,
  RunEnvironment,
  WatermarkKind,
} from "./types.js";

export type {
  Attack,
  AttackContext,
  AttackResult,
} from "./attacks/types.js";
export { defaultAttacks, getAttackById } from "./attacks/registry.js";
export { reencodeH264Crf23 } from "./attacks/reencode.js";
export { platformSimYoutube1080p } from "./attacks/platform-sim-youtube.js";
export { abrLadderHlsDefault } from "./attacks/abr-ladder.js";
export {
  containerStripC2pa,
  stripC2paUuidBoxes,
  C2PA_UUID,
} from "./attacks/container-strip-c2pa.js";
export type { StripResult } from "./attacks/container-strip-c2pa.js";
export {
  containerStripXmp,
  stripXmpPackets,
  XMP_UUID,
} from "./attacks/xmp-strip.js";
export type { XmpStripResult } from "./attacks/xmp-strip.js";
export { AttackError } from "./attacks/shared.js";

export type {
  Detector,
  DetectorContext,
  DetectionResult,
} from "./detectors/types.js";
export { defaultDetectors, getDetectorById } from "./detectors/registry.js";
export { nullDetector } from "./detectors/null.js";
export {
  c2paDetector,
  createC2paDetector,
  classifyValidationReport,
} from "./detectors/c2pa.js";
export type {
  C2paDetectorOptions,
  ValidationReportLike,
} from "./detectors/c2pa.js";
export {
  xmpDstDetector,
  classifyXmpScan,
  scanBytesForXmpDst,
} from "./detectors/xmp-dst.js";
export type { XmpDstScan } from "./detectors/xmp-dst.js";

export type {
  MatrixCell,
  MatrixReport,
  ProgressEvent,
  RunMatrixOptions,
} from "./runner/matrix.js";
export { runMatrix } from "./runner/matrix.js";

export type { DetectorScore } from "./reporting/score.js";
export { scoreReport } from "./reporting/score.js";

export type { JsonReportEnvelope } from "./reporting/json.js";
export { buildJsonReport, writeJsonReport } from "./reporting/json.js";

export { loadCorpus, sha256File, CorpusLoadError } from "./corpus/loader.js";
export type {
  CorpusFile,
  CorpusFileItem,
  LoadedCorpusItem,
  LoadCorpusOptions,
} from "./corpus/loader.js";
