import { execa } from "execa";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { Attack, AttackContext, AttackResult } from "./types.js";
import type { CorpusItem } from "../types.js";
import { AttackError, tailLines } from "./shared.js";

export { AttackError };

/**
 * Reference attack: vanilla H.264 re-encode at CRF 23.
 *
 * This is the weakest attack in the battery. If a watermark does not survive
 * a single-pass CRF-23 re-encode, it is not survival-grade for any real-world
 * pipeline. It exists as a smoke-test floor and as a control against which
 * stronger attacks (bitrate ladder, platform-sim, screen-capture) are
 * calibrated. See METHODOLOGY.md §A1.
 */
export const reencodeH264Crf23: Attack = {
  id: "reencode.h264.crf23",
  category: "reencode",
  title: "H.264 re-encode @ CRF 23 (baseline floor)",
  description:
    "Single-pass libx264 re-encode at CRF 23, veryfast preset, AAC audio. " +
    "Floor attack — a watermark that does not survive this will not survive " +
    "anything that happens downstream of an upload to a consumer platform.",
  methodologyRef: "METHODOLOGY.md#A1",

  async run(input: CorpusItem, ctx: AttackContext): Promise<AttackResult> {
    const started = performance.now();
    const outputPath = path.join(
      ctx.workDir,
      `${input.id}__${this.id}.mp4`,
    );

    const ffmpegArgs = [
      "-y",
      "-i",
      input.path,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outputPath,
    ];

    const result = await execa(ctx.ffmpegPath, ffmpegArgs, {
      reject: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (result.exitCode !== 0) {
      throw new AttackError(
        `ffmpeg exited ${result.exitCode ?? "unknown"} during ${reencodeH264Crf23.id}`,
        result.stderr?.toString() ?? "",
      );
    }

    return {
      attackId: this.id,
      inputId: input.id,
      outputPath,
      durationMs: Math.round(performance.now() - started),
      stderrTail: tailLines(result.stderr?.toString() ?? "", 10),
    };
  },
};

