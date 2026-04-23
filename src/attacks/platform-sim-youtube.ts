import { execa } from "execa";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { Attack, AttackContext, AttackResult } from "./types.js";
import type { CorpusItem } from "../types.js";
import { AttackError, tailLines } from "./shared.js";

/**
 * YouTube 1080p UGC-upload signature.
 *
 * Not YouTube's actual pipeline — we cannot see inside it — but close enough
 * to the resolution/codec/bitrate signature that a watermark surviving this
 * is likely to survive a real YT re-upload. Chosen parameters match what YT
 * typically emits today for 1080p30 VP9 UGC (public telemetry; tune on the
 * next methodology bump if YT moves the target).
 *
 *   - scale: max height 1080, width = round to even, preserve aspect
 *   - fps: capped at 30 (higher fps inputs are decimated; lower are kept)
 *   - video: libvpx-vp9 single-pass VBR ~4 Mbps, GOP 2s, deadline=good
 *   - audio: libopus 128 kbps
 *   - container: WebM
 *
 * WebM output is deliberate — YT's 1080p30 UGC path produces WebM/VP9/Opus,
 * and some watermark detectors expect MP4 input; if a vendor's detector
 * cannot read WebM, that is a finding worth surfacing. See METHODOLOGY.md§A2.
 */
export const platformSimYoutube1080p: Attack = {
  id: "platform-sim.youtube.1080p",
  category: "platform-sim",
  title: "YouTube 1080p30 UGC (VP9 / Opus / WebM)",
  description:
    "Simulates the YouTube 1080p30 UGC-upload encoding signature: scale to " +
    "max 1080p, cap at 30 fps, libvpx-vp9 ~4 Mbps VBR with GOP 2s, libopus " +
    "128 kbps audio, WebM container. A watermark that does not survive this " +
    "is not survival-grade for a YT re-upload.",
  methodologyRef: "METHODOLOGY.md#A2",

  async run(input: CorpusItem, ctx: AttackContext): Promise<AttackResult> {
    const started = performance.now();
    const outputPath = path.join(
      ctx.workDir,
      `${input.id}__${this.id}.webm`,
    );

    const ffmpegArgs = [
      "-y",
      "-i",
      input.path,
      "-vf",
      // round width to even; clamp height at 1080.
      "scale=-2:'min(1080,ih)'",
      "-r",
      "30",
      "-c:v",
      "libvpx-vp9",
      "-b:v",
      "4M",
      "-maxrate",
      "5M",
      "-minrate",
      "2M",
      "-g",
      "60",
      "-deadline",
      "good",
      "-cpu-used",
      "4",
      "-row-mt",
      "1",
      "-c:a",
      "libopus",
      "-b:a",
      "128k",
      outputPath,
    ];

    const result = await execa(ctx.ffmpegPath, ffmpegArgs, {
      reject: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (result.exitCode !== 0) {
      throw new AttackError(
        `ffmpeg exited ${result.exitCode ?? "unknown"} during ${platformSimYoutube1080p.id}`,
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
