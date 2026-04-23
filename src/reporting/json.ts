import { writeFile } from "node:fs/promises";
import type { MatrixReport } from "../runner/matrix.js";
import { scoreReport, type DetectorScore } from "./score.js";

/**
 * Wire-stable JSON envelope written to `reports/<runId>.json`.
 *
 * Fields are ordered intentionally: `schema` first so readers can dispatch,
 * then identity metadata, then scoring, then raw matrix. Scoring appears
 * before cells so a human can read the verdict before the evidence.
 */
export interface JsonReportEnvelope {
  readonly schema: "ai-watermark-robustness/v0.0";
  readonly runId: string;
  readonly generatedAt: string;
  readonly summary: {
    readonly inputs: number;
    readonly attacks: number;
    readonly detectors: number;
    readonly cells: number;
  };
  readonly scores: readonly DetectorScore[];
  readonly report: MatrixReport;
}

export function buildJsonReport(
  report: MatrixReport,
  runId: string,
): JsonReportEnvelope {
  return {
    schema: "ai-watermark-robustness/v0.0",
    runId,
    generatedAt: new Date().toISOString(),
    summary: {
      inputs: report.corpus.length,
      attacks: report.attacks.length,
      detectors: report.detectors.length,
      cells: report.cells.length,
    },
    scores: scoreReport(report),
    report,
  };
}

export async function writeJsonReport(
  path: string,
  envelope: JsonReportEnvelope,
): Promise<void> {
  await writeFile(path, JSON.stringify(envelope, null, 2), "utf8");
}
