import { execa } from "execa";
import type { Detector, DetectionResult, DetectorContext } from "./types.js";

/**
 * C2PA detector backed by the `c2pa-manifest-validator` CLI.
 *
 * Invocation contract:
 *
 *   `<validatorCommand> <mediaPath> --json`
 *
 * emits a `ValidationReport` JSON document on stdout and exits with:
 *
 *   0 = clean (no ERROR-severity issues)
 *   1 = errors present (may still mean manifest detected but failed validation)
 *   2 = usage / unrecoverable I/O error (treated as detector error here)
 *
 * See ../../docs/DETECTORS.md for the confidence semantics this detector
 * implements and why. The pure classification step lives in
 * `classifyValidationReport` so it can be unit-tested without shelling out.
 */

/** Minimal subset of the upstream `ValidationReport` shape we depend on. */
export interface ValidationReportLike {
  readonly issues: ReadonlyArray<{
    readonly ruleId: string;
    readonly severity: "error" | "warning" | "info";
    readonly statusCode?: string;
  }>;
  readonly counts: { readonly error: number; readonly warning: number; readonly info: number };
}

export interface C2paDetectorOptions {
  /**
   * Command used to invoke the validator. Defaults to `c2pa-validate`
   * (assumes the binary is on PATH — `npm link` or `npm i -g`).
   * Override with the `C2PA_VALIDATE_BIN` env var or this option for local
   * sibling-repo development: e.g. `node ../c2pa-manifest-validator/dist/bin/c2pa-validate.js`.
   */
  readonly validatorCommand?: string;
}

const MANIFEST_MISSING_RULE_ID = "manifest/manifest-present";
const MANIFEST_MISSING_STATUS_CODE = "claim.missing";

/**
 * Classify a `ValidationReport` into a `DetectionResult`.
 *
 * Pure function. Deterministic. No I/O. Unit-tested.
 *
 *   - `claim.missing` or `manifest/manifest-present` error →
 *     no C2PA manifest present → detected=false, confidence=0
 *   - Any other error(s) on a present manifest →
 *     manifest parsed but failed validation → detected=true, confidence=0.5
 *   - Clean report → verified → detected=true, confidence=1
 */
export function classifyValidationReport(
  report: ValidationReportLike,
): DetectionResult {
  const hasManifestMissing = report.issues.some(
    (i) =>
      i.severity === "error" &&
      (i.ruleId === MANIFEST_MISSING_RULE_ID ||
        i.statusCode === MANIFEST_MISSING_STATUS_CODE),
  );

  if (hasManifestMissing) {
    return {
      detectorId: "detector.c2pa",
      detected: false,
      confidence: 0,
      evidence: { reason: "manifest-missing", errorCount: report.counts.error },
    };
  }

  if (report.counts.error > 0) {
    return {
      detectorId: "detector.c2pa",
      detected: true,
      confidence: 0.5,
      evidence: {
        reason: "manifest-present-errors",
        errorCount: report.counts.error,
        ruleIds: report.issues
          .filter((i) => i.severity === "error")
          .map((i) => i.ruleId),
      },
    };
  }

  return {
    detectorId: "detector.c2pa",
    detected: true,
    confidence: 1,
    evidence: { reason: "manifest-verified", errorCount: 0 },
  };
}

export function createC2paDetector(opts: C2paDetectorOptions = {}): Detector {
  const fromEnv = process.env["C2PA_VALIDATE_BIN"];
  const command =
    opts.validatorCommand ??
    (fromEnv && fromEnv.length > 0 ? fromEnv : "c2pa-validate");

  return {
    id: "detector.c2pa",
    watermarkKind: "c2pa",
    title: "C2PA manifest (via c2pa-manifest-validator)",
    description:
      "Shells out to the c2pa-manifest-validator CLI. A file is `detected` " +
      "when a C2PA claim box is parseable; `confidence` is 1.0 when the " +
      "validator finds no errors, and 0.5 when the manifest is present but " +
      "has error-severity issues (e.g. invalid signature, hash mismatch).",

    async detect(
      mediaPath: string,
      _ctx: DetectorContext,
    ): Promise<DetectionResult> {
      const parts = splitCommand(command);
      const [binary, ...baseArgs] = parts;
      if (!binary) {
        return {
          detectorId: "detector.c2pa",
          detected: false,
          confidence: 0,
          errorMessage: `Empty validator command: ${JSON.stringify(command)}`,
        };
      }

      const result = await execa(binary, [...baseArgs, mediaPath, "--json"], {
        reject: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Exit code 2 is reserved for usage / unrecoverable I/O errors. We treat
      // those as detector errors, not survival failures, so the runner can
      // surface them distinctly in the report.
      if (result.exitCode === 2) {
        return {
          detectorId: "detector.c2pa",
          detected: false,
          confidence: 0,
          errorMessage: `c2pa-validate exit 2: ${tailLines(result.stderr?.toString() ?? "", 5)}`,
        };
      }

      const stdout = result.stdout?.toString() ?? "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch (err) {
        return {
          detectorId: "detector.c2pa",
          detected: false,
          confidence: 0,
          errorMessage: `Could not parse c2pa-validate JSON output: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      if (!looksLikeValidationReport(parsed)) {
        return {
          detectorId: "detector.c2pa",
          detected: false,
          confidence: 0,
          errorMessage:
            "c2pa-validate JSON did not match expected ValidationReport shape",
        };
      }

      return classifyValidationReport(parsed);
    },
  };
}

/**
 * A default instance wired against `c2pa-validate` on PATH (or whatever
 * `C2PA_VALIDATE_BIN` points at). Exported so the registry can opt in without
 * callers needing to construct it.
 */
export const c2paDetector: Detector = createC2paDetector();

function splitCommand(command: string): readonly string[] {
  // Support `node /path/to/c2pa-validate.js` style overrides as well as a
  // plain binary name. We split on unquoted whitespace — sufficient for dev
  // use; we don't need a full shell parser here.
  return command
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0);
}

function tailLines(text: string, n: number): string {
  if (!text) return "";
  return text.split(/\r?\n/).slice(-n).join("\n").trim();
}

function looksLikeValidationReport(x: unknown): x is ValidationReportLike {
  if (!x || typeof x !== "object") return false;
  const rec = x as Record<string, unknown>;
  if (!Array.isArray(rec["issues"])) return false;
  const counts = rec["counts"];
  if (!counts || typeof counts !== "object") return false;
  const c = counts as Record<string, unknown>;
  return (
    typeof c["error"] === "number" &&
    typeof c["warning"] === "number" &&
    typeof c["info"] === "number"
  );
}
