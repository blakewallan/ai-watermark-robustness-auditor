import { describe, expect, it } from "vitest";
import {
  abrLadderHlsDefault,
  containerStripC2pa,
  defaultAttacks,
  defaultDetectors,
  getAttackById,
  getDetectorById,
  platformSimYoutube1080p,
  reencodeH264Crf23,
  nullDetector,
  scoreReport,
  type MatrixReport,
} from "../src/index.js";

describe("registries", () => {
  it("exposes the reference reencode attack", () => {
    expect(defaultAttacks).toContain(reencodeH264Crf23);
    expect(getAttackById(reencodeH264Crf23.id)).toBe(reencodeH264Crf23);
  });

  it("exposes the weekend-2 attack trio", () => {
    for (const a of [
      platformSimYoutube1080p,
      abrLadderHlsDefault,
      containerStripC2pa,
    ]) {
      expect(defaultAttacks).toContain(a);
      expect(getAttackById(a.id)).toBe(a);
    }
  });

  it("assigns each attack a unique id", () => {
    const ids = defaultAttacks.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("uses the documented category taxonomy", () => {
    expect(platformSimYoutube1080p.category).toBe("platform-sim");
    expect(abrLadderHlsDefault.category).toBe("abr-ladder");
    expect(containerStripC2pa.category).toBe("container");
  });

  it("points every attack at a methodology anchor", () => {
    for (const a of defaultAttacks) {
      expect(a.methodologyRef).toMatch(/^METHODOLOGY\.md#/);
    }
  });

  it("exposes the null detector for wiring", () => {
    expect(defaultDetectors).toContain(nullDetector);
    expect(getDetectorById(nullDetector.id)).toBe(nullDetector);
  });

  it("returns undefined for unknown ids", () => {
    expect(getAttackById("nope.does.not.exist")).toBeUndefined();
    expect(getDetectorById("nope.does.not.exist")).toBeUndefined();
  });
});

describe("scoring", () => {
  it("excludes cells with no baseline detection from the denominator", () => {
    const report: MatrixReport = {
      env: {
        methodologyVersion: "0.0-test",
        auditorVersion: "0.0.0",
        ffmpegVersion: "test",
        os: "test",
        nodeVersion: "test",
        startedAt: "2026-01-01T00:00:00Z",
        finishedAt: "2026-01-01T00:00:01Z",
      },
      corpus: [],
      attacks: [{ id: "a1", category: "reencode", title: "a1" }],
      detectors: [{ id: "d1", watermarkKind: "c2pa", title: "d1" }],
      baseline: [],
      cells: [
        {
          inputId: "i1",
          attackId: "a1",
          detectorId: "d1",
          baselineDetected: true,
          postAttackDetected: true,
          postAttackConfidence: 1,
          attackDurationMs: 1,
        },
        {
          inputId: "i2",
          attackId: "a1",
          detectorId: "d1",
          baselineDetected: false,
          postAttackDetected: false,
          postAttackConfidence: 0,
          attackDurationMs: 1,
        },
      ],
    };

    const scores = scoreReport(report);
    expect(scores).toHaveLength(1);
    const s = scores[0]!;
    expect(s.cellsConsidered).toBe(1);
    expect(s.survived).toBe(1);
    expect(s.survivalRate).toBe(1);
    expect(s.grade).toBe("A");
    expect(s.excludedNoBaseline).toBe(1);
    expect(s.excludedAttackError).toBe(0);
  });

  it("excludes attack-error cells from the denominator", () => {
    // A cell whose attack threw before producing output tells us nothing
    // about the watermark's robustness — it tells us about the attack
    // module's bug. Counting it as "did not survive" would be false signal.
    const report: MatrixReport = {
      env: {
        methodologyVersion: "0.0-test",
        auditorVersion: "0.0.0",
        ffmpegVersion: "test",
        os: "test",
        nodeVersion: "test",
        startedAt: "x",
        finishedAt: "x",
      },
      corpus: [],
      attacks: [{ id: "a1", category: "reencode", title: "a1" }],
      detectors: [{ id: "d1", watermarkKind: "c2pa", title: "d1" }],
      baseline: [],
      cells: [
        // baseline=Y, attack ok, post=Y → survived
        {
          inputId: "i1",
          attackId: "a1",
          detectorId: "d1",
          baselineDetected: true,
          postAttackDetected: true,
          postAttackConfidence: 1,
          attackDurationMs: 1,
        },
        // baseline=Y, attack failed → excluded
        {
          inputId: "i2",
          attackId: "a1",
          detectorId: "d1",
          baselineDetected: true,
          postAttackDetected: false,
          postAttackConfidence: 0,
          attackDurationMs: 1,
          attackErrorMessage: "ffmpeg exited 1",
        },
        // baseline=N → excluded
        {
          inputId: "i3",
          attackId: "a1",
          detectorId: "d1",
          baselineDetected: false,
          postAttackDetected: false,
          postAttackConfidence: 0,
          attackDurationMs: 1,
        },
      ],
    };

    const [s] = scoreReport(report);
    expect(s!.cellsConsidered).toBe(1);
    expect(s!.survived).toBe(1);
    expect(s!.survivalRate).toBe(1);
    expect(s!.excludedNoBaseline).toBe(1);
    expect(s!.excludedAttackError).toBe(1);
  });

  it("assigns letter grades at the documented thresholds", () => {
    const mk = (rate: number): MatrixReport => ({
      env: {
        methodologyVersion: "0.0-test",
        auditorVersion: "0.0.0",
        ffmpegVersion: "test",
        os: "test",
        nodeVersion: "test",
        startedAt: "x",
        finishedAt: "x",
      },
      corpus: [],
      attacks: [{ id: "a", category: "reencode", title: "a" }],
      detectors: [{ id: "d", watermarkKind: "c2pa", title: "d" }],
      baseline: [],
      cells: Array.from({ length: 100 }, (_, i) => ({
        inputId: `i${i}`,
        attackId: "a",
        detectorId: "d",
        baselineDetected: true,
        postAttackDetected: i < Math.round(rate * 100),
        postAttackConfidence: i < Math.round(rate * 100) ? 1 : 0,
        attackDurationMs: 1,
      })),
    });

    expect(scoreReport(mk(1.0))[0]!.grade).toBe("A");
    expect(scoreReport(mk(0.9))[0]!.grade).toBe("B");
    expect(scoreReport(mk(0.75))[0]!.grade).toBe("C");
    expect(scoreReport(mk(0.6))[0]!.grade).toBe("D");
    expect(scoreReport(mk(0.3))[0]!.grade).toBe("F");
  });
});
