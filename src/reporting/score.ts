import type { RobustnessGrade } from "../types.js";
import type { MatrixCell, MatrixReport } from "../runner/matrix.js";

/**
 * Per-detector survival rate on a MatrixReport.
 *
 * A cell contributes to the survival denominator only when:
 *   1. baseline detection was `true` (otherwise the attack has nothing to
 *      destroy — an absent watermark cannot "survive"), AND
 *   2. the attack actually produced an output (no `attackErrorMessage`) —
 *      otherwise we would be reporting the attack module's bug as watermark
 *      fragility.
 *
 * The `excluded` counters let a downstream reader see what was dropped and
 * why, so they can sanity-check the denominator without re-running the
 * matrix. `excludedNoBaseline + excludedAttackError + cellsConsidered`
 * always equals the total cells for this detector.
 *
 * Grade thresholds are versioned with the methodology doc and must not drift
 * without bumping `methodologyVersion` on the report envelope. See
 * METHODOLOGY.md §Scoring.
 */
export interface DetectorScore {
  readonly detectorId: string;
  readonly cellsConsidered: number;
  readonly survived: number;
  readonly survivalRate: number;
  readonly grade: RobustnessGrade;
  readonly excludedNoBaseline: number;
  readonly excludedAttackError: number;
}

const GRADE_THRESHOLDS: ReadonlyArray<readonly [number, RobustnessGrade]> = [
  [0.95, "A"],
  [0.85, "B"],
  [0.7, "C"],
  [0.5, "D"],
  [0.0, "F"],
];

export function scoreReport(report: MatrixReport): readonly DetectorScore[] {
  return report.detectors.map((detector) => {
    const detectorCells = report.cells.filter(
      (c) => c.detectorId === detector.id,
    );
    const noBaseline = detectorCells.filter((c) => !c.baselineDetected);
    const attackFailed = detectorCells.filter(
      (c) => c.baselineDetected && !!c.attackErrorMessage,
    );
    const relevant = detectorCells.filter(
      (c) => c.baselineDetected && !c.attackErrorMessage,
    );
    const survived = relevant.filter(isSurvivor).length;
    const survivalRate = relevant.length > 0 ? survived / relevant.length : 0;

    return {
      detectorId: detector.id,
      cellsConsidered: relevant.length,
      survived,
      survivalRate,
      grade: gradeFor(survivalRate),
      excludedNoBaseline: noBaseline.length,
      excludedAttackError: attackFailed.length,
    };
  });
}

function isSurvivor(cell: MatrixCell): boolean {
  return cell.postAttackDetected && cell.postAttackConfidence >= 0.5;
}

function gradeFor(rate: number): RobustnessGrade {
  for (const [threshold, grade] of GRADE_THRESHOLDS) {
    if (rate >= threshold) return grade;
  }
  return "F";
}
