import { mkdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { CorpusItem, RunEnvironment } from "../types.js";
import type { Attack } from "../attacks/types.js";
import type { Detector } from "../detectors/types.js";

/**
 * One cell of the attack × detector × input matrix.
 *
 * NOTE: a matrix cell records BOTH the attack result and the detection result
 * against the post-attack media. The baseline (pre-attack) detection is
 * recorded separately per input in `MatrixReport.baseline` so survival rates
 * can be computed without conflating "never detected" with "attacked off".
 */
export interface MatrixCell {
  readonly inputId: string;
  readonly attackId: string;
  readonly detectorId: string;
  readonly baselineDetected: boolean;
  readonly postAttackDetected: boolean;
  readonly postAttackConfidence: number;
  readonly attackDurationMs: number;
  readonly detectErrorMessage?: string;
  readonly attackErrorMessage?: string;
}

export interface MatrixReport {
  readonly env: RunEnvironment;
  readonly corpus: readonly CorpusItem[];
  readonly attacks: ReadonlyArray<{ id: string; category: string; title: string }>;
  readonly detectors: ReadonlyArray<{ id: string; watermarkKind: string; title: string }>;
  readonly baseline: ReadonlyArray<{
    inputId: string;
    detectorId: string;
    detected: boolean;
    confidence: number;
  }>;
  readonly cells: readonly MatrixCell[];
}

export interface RunMatrixOptions {
  readonly corpus: readonly CorpusItem[];
  readonly attacks: readonly Attack[];
  readonly detectors: readonly Detector[];
  readonly workDir: string;
  readonly ffmpegPath: string;
  readonly env: Omit<RunEnvironment, "startedAt" | "finishedAt">;
  readonly onProgress?: (event: ProgressEvent) => void;
}

export type ProgressEvent =
  | { readonly kind: "baseline"; readonly inputId: string; readonly detectorId: string }
  | { readonly kind: "attack"; readonly inputId: string; readonly attackId: string }
  | {
      readonly kind: "detect";
      readonly inputId: string;
      readonly attackId: string;
      readonly detectorId: string;
    };

export async function runMatrix(opts: RunMatrixOptions): Promise<MatrixReport> {
  const startedAt = new Date().toISOString();
  await mkdir(opts.workDir, { recursive: true });

  const baseline: MatrixReport["baseline"][number][] = [];
  for (const input of opts.corpus) {
    for (const detector of opts.detectors) {
      opts.onProgress?.({ kind: "baseline", inputId: input.id, detectorId: detector.id });
      const det = await detector.detect(input.path, { workDir: opts.workDir });
      baseline.push({
        inputId: input.id,
        detectorId: detector.id,
        detected: det.detected,
        confidence: det.confidence,
      });
    }
  }

  const cells: MatrixCell[] = [];
  for (const input of opts.corpus) {
    for (const attack of opts.attacks) {
      opts.onProgress?.({ kind: "attack", inputId: input.id, attackId: attack.id });

      const attackWorkDir = path.join(opts.workDir, "artifacts");
      await mkdir(attackWorkDir, { recursive: true });

      let outputPath: string | undefined;
      let attackDurationMs = 0;
      let attackErrorMessage: string | undefined;

      const attackStart = performance.now();
      try {
        const res = await attack.run(input, {
          workDir: attackWorkDir,
          ffmpegPath: opts.ffmpegPath,
        });
        outputPath = res.outputPath;
        attackDurationMs = res.durationMs;
      } catch (err) {
        attackDurationMs = Math.round(performance.now() - attackStart);
        attackErrorMessage = err instanceof Error ? err.message : String(err);
      }

      for (const detector of opts.detectors) {
        opts.onProgress?.({
          kind: "detect",
          inputId: input.id,
          attackId: attack.id,
          detectorId: detector.id,
        });

        const basePoint = baseline.find(
          (b) => b.inputId === input.id && b.detectorId === detector.id,
        );

        if (attackErrorMessage || !outputPath) {
          cells.push({
            inputId: input.id,
            attackId: attack.id,
            detectorId: detector.id,
            baselineDetected: basePoint?.detected ?? false,
            postAttackDetected: false,
            postAttackConfidence: 0,
            attackDurationMs,
            ...(attackErrorMessage ? { attackErrorMessage } : {}),
          });
          continue;
        }

        try {
          const det = await detector.detect(outputPath, { workDir: opts.workDir });
          cells.push({
            inputId: input.id,
            attackId: attack.id,
            detectorId: detector.id,
            baselineDetected: basePoint?.detected ?? false,
            postAttackDetected: det.detected,
            postAttackConfidence: det.confidence,
            attackDurationMs,
            ...(det.errorMessage ? { detectErrorMessage: det.errorMessage } : {}),
          });
        } catch (err) {
          cells.push({
            inputId: input.id,
            attackId: attack.id,
            detectorId: detector.id,
            baselineDetected: basePoint?.detected ?? false,
            postAttackDetected: false,
            postAttackConfidence: 0,
            attackDurationMs,
            detectErrorMessage: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  const finishedAt = new Date().toISOString();

  return {
    env: { ...opts.env, startedAt, finishedAt },
    corpus: opts.corpus,
    attacks: opts.attacks.map((a) => ({
      id: a.id,
      category: a.category,
      title: a.title,
    })),
    detectors: opts.detectors.map((d) => ({
      id: d.id,
      watermarkKind: d.watermarkKind,
      title: d.title,
    })),
    baseline,
    cells,
  };
}
