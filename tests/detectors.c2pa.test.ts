import { describe, it, expect } from "vitest";
import {
  classifyValidationReport,
  type ValidationReportLike,
} from "../src/detectors/c2pa.js";

function report(
  issues: ValidationReportLike["issues"],
  counts?: Partial<ValidationReportLike["counts"]>,
): ValidationReportLike {
  const error = counts?.error ?? issues.filter((i) => i.severity === "error").length;
  const warning = counts?.warning ?? issues.filter((i) => i.severity === "warning").length;
  const info = counts?.info ?? issues.filter((i) => i.severity === "info").length;
  return { issues, counts: { error, warning, info } };
}

describe("classifyValidationReport", () => {
  it("treats a clean report as verified (confidence=1)", () => {
    const r = classifyValidationReport(report([]));
    expect(r.detected).toBe(true);
    expect(r.confidence).toBe(1);
    expect(r.detectorId).toBe("detector.c2pa");
  });

  it("treats `manifest/manifest-present` error as not-detected (confidence=0)", () => {
    const r = classifyValidationReport(
      report([
        {
          ruleId: "manifest/manifest-present",
          severity: "error",
          statusCode: "claim.missing",
        },
      ]),
    );
    expect(r.detected).toBe(false);
    expect(r.confidence).toBe(0);
    expect(r.evidence?.["reason"]).toBe("manifest-missing");
  });

  it("recognises `claim.missing` status code even without the specific rule id", () => {
    const r = classifyValidationReport(
      report([
        {
          ruleId: "some/other-rule",
          severity: "error",
          statusCode: "claim.missing",
        },
      ]),
    );
    expect(r.detected).toBe(false);
    expect(r.evidence?.["reason"]).toBe("manifest-missing");
  });

  it("treats a present-but-broken manifest as detected with 0.5 confidence", () => {
    const r = classifyValidationReport(
      report([
        {
          ruleId: "manifest/claim-signature-valid",
          severity: "error",
          statusCode: "signature.invalid",
        },
        {
          ruleId: "manifest/hard-binding-hash-valid",
          severity: "error",
          statusCode: "assertion.dataHash.mismatch",
        },
      ]),
    );
    expect(r.detected).toBe(true);
    expect(r.confidence).toBe(0.5);
    expect(r.evidence?.["reason"]).toBe("manifest-present-errors");
    expect(r.evidence?.["errorCount"]).toBe(2);
    expect(r.evidence?.["ruleIds"]).toEqual([
      "manifest/claim-signature-valid",
      "manifest/hard-binding-hash-valid",
    ]);
  });

  it("ignores warnings and infos when no errors are present", () => {
    const r = classifyValidationReport(
      report([
        { ruleId: "manifest/soft-binding", severity: "warning" },
        { ruleId: "manifest/ingredient-chain-valid", severity: "info" },
      ]),
    );
    expect(r.detected).toBe(true);
    expect(r.confidence).toBe(1);
  });

  it("prefers manifest-missing over other errors when both are present", () => {
    // Pathological: shouldn't happen in practice, but we document the
    // precedence explicitly so the behaviour is predictable.
    const r = classifyValidationReport(
      report([
        { ruleId: "manifest/manifest-present", severity: "error", statusCode: "claim.missing" },
        { ruleId: "manifest/claim-signature-valid", severity: "error" },
      ]),
    );
    expect(r.detected).toBe(false);
    expect(r.confidence).toBe(0);
  });
});
