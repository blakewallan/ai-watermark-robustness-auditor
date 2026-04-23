import type { Detector, DetectionResult } from "./types.js";

/**
 * Null detector. Always answers "not detected" with zero confidence.
 *
 * Purpose: lets the matrix runner wire end-to-end before any real detector
 * backend is plugged in. Also useful as a negative control in CI — if a
 * real detector ever agrees with the null detector on a watermarked input,
 * something is wrong.
 */
export const nullDetector: Detector = {
  id: "detector.null",
  watermarkKind: "unknown",
  title: "Null detector (negative control)",
  description:
    "Always answers `detected = false`. Wiring smoke-test and negative " +
    "control; never ship a robustness score that only ran against this.",

  async detect(): Promise<DetectionResult> {
    return {
      detectorId: "detector.null",
      detected: false,
      confidence: 0,
    };
  },
};
