import type { WatermarkKind } from "../types.js";

/**
 * Detectors take a media file on disk and answer: did the watermark survive?
 *
 * The interface is intentionally narrow so that closed-source detectors
 * (Digimarc SDK, Hive API, etc.) can wrap their native call here without the
 * runner caring how the check is performed.
 */
export interface Detector {
  readonly id: string;
  readonly watermarkKind: WatermarkKind;
  readonly title: string;
  readonly description: string;
  detect(mediaPath: string, ctx: DetectorContext): Promise<DetectionResult>;
}

export interface DetectorContext {
  readonly workDir: string;
}

/**
 * `confidence` is 0..1 when the detector produces one. For binary detectors
 * (C2PA manifest present / absent) use `1.0` on detected and `0.0` on not.
 *
 * `evidence` is detector-specific free-form JSON that gets embedded verbatim
 * in the signed report so reviewers can audit the decision.
 */
export interface DetectionResult {
  readonly detectorId: string;
  readonly detected: boolean;
  readonly confidence: number;
  readonly evidence?: Record<string, unknown>;
  readonly errorMessage?: string;
}
