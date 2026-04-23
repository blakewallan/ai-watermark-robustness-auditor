/**
 * Core types shared across attacks, detectors, the runner, and reports.
 *
 * Design notes:
 *   - `WatermarkKind` is the disclosure family we're testing. C2PA manifests,
 *     SynthID-style invisible pixel marks, Digimarc / Truepic / Hive proprietary
 *     marks, and IPTC `DigitalSourceType` metadata are the launch set.
 *   - `AttackCategory` mirrors the attack families documented in
 *     `docs/ATTACKS.md` and the methodology doc. Keep them in sync.
 *   - Nothing in this file should import from attacks/ or detectors/ — it is
 *     the dependency root.
 */

export type WatermarkKind =
  | "c2pa"
  | "iptc-xmp"
  | "synthid"
  | "digimarc"
  | "truepic"
  | "hive"
  | "stegastamp"
  | "unknown";

export type AttackCategory =
  | "reencode"
  | "platform-sim"
  | "abr-ladder"
  | "screen-capture"
  | "geometric"
  | "temporal"
  | "color"
  | "filter"
  | "compression-starvation"
  | "container";

/**
 * A single input sample under test. Paths are absolute on the local filesystem.
 */
export interface CorpusItem {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly expectedWatermarks: readonly WatermarkKind[];
  readonly notes?: string;
}

/**
 * Letter grades applied to survival percentages. Thresholds are defined in
 * `docs/METHODOLOGY.md` and must not drift without a methodology version bump.
 */
export type RobustnessGrade = "A" | "B" | "C" | "D" | "F";

/**
 * Deterministic environment fingerprint captured per run so reports can be
 * re-verified offline. See METHODOLOGY.md §Reproducibility.
 */
export interface RunEnvironment {
  readonly methodologyVersion: string;
  readonly auditorVersion: string;
  readonly ffmpegVersion: string;
  readonly os: string;
  readonly nodeVersion: string;
  readonly startedAt: string;
  readonly finishedAt: string;
}
