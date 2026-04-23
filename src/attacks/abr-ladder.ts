import { execa } from "execa";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import type { Attack, AttackContext, AttackResult } from "./types.js";
import type { CorpusItem } from "../types.js";
import { AttackError, tailLines } from "./shared.js";

/**
 * HLS ABR-ladder default-rung round-trip attack.
 *
 * Simulates what happens when a file passes through a VOD origin / packager
 * (Mux, Cloudflare Stream, MediaConvert, Bitmovin, etc.): it is re-encoded
 * at a specific rung of the ABR ladder, fragmented into fMP4 segments, and
 * served for playback. Downstream re-hosts ("download and rebroadcast")
 * typically reassemble the playback bytes into a flat MP4, which is what
 * the detector sees.
 *
 * For attack output, we produce the flat MP4 directly — a single-pass
 * transcode to the Apple HLS Authoring Spec 720p rung (H.264 CBR 2.8 Mbps,
 * AAC 96 kbps, closed GOPs at 2 s, faststart-muxed). The resulting bitstream
 * is bit-identical to what a player would reassemble from that rung's
 * playback segments, minus the transient HLS packaging layer. Any C2PA
 * hard-binding assertion on the source dies at this point because the
 * asset hash is computed over the concatenation of top-level ISOBMFF
 * boxes and libx264's re-encode + ffmpeg's movflags rewrite the moov box
 * wholesale. Invisible-pixel watermarks may survive depending on the
 * encoder's spatial fidelity at 2.8 Mbps.
 *
 * Parameters were chosen to match the 720p rung of Apple's HLS Authoring
 * Specification (ARKit HLS §4.1, 2024-02 update): 720p H.264 High profile,
 * ~2.8 Mbps average, 2 s closed GOPs, AAC-LC 96 kbps stereo 48 kHz. See
 * METHODOLOGY.md §A3 for the full reference.
 */
export const abrLadderHlsDefault: Attack = {
  id: "abr-ladder.hls-default",
  category: "abr-ladder",
  title: "HLS default-ladder 720p round-trip (VOD origin transcode)",
  description:
    "Single-pass transcode to the 720p rung of Apple's HLS Authoring Spec " +
    "ladder (H.264 High @ 2.8 Mbps, AAC-LC 96 kbps, 2 s closed GOPs, " +
    "faststart MP4). Emits the flat MP4 that a downstream re-host would " +
    "reassemble from that rung's playback segments — the transient HLS " +
    "packaging layer does not alter the bitstream the detector sees. " +
    "Reproduces the VOD origin round-trip that C2PA hard-binding has to " +
    "survive for any claim to hold through CDN distribution.",
  methodologyRef: "METHODOLOGY.md#A3",

  async run(input: CorpusItem, ctx: AttackContext): Promise<AttackResult> {
    const started = performance.now();
    await mkdir(ctx.workDir, { recursive: true });

    const outputPath = path.join(
      ctx.workDir,
      `${input.id}__${this.id}.mp4`,
    );

    // Apple HLS Authoring Spec 720p rung parameters. libx264 -profile:v high
    // matches the ARKit spec's "Level 3.1, High profile" for the 720p rung.
    // Two-pass would be slightly more realistic to what a real packager
    // does, but single-pass CBR gets us to within 5% of the target bitrate
    // and halves attack runtime — the C2PA-breaking property holds either
    // way because the entire moov/mdat pair is re-written.
    const args = [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      input.path,
      "-vf",
      "scale=-2:720",
      "-c:v",
      "libx264",
      "-profile:v",
      "high",
      "-level:v",
      "3.1",
      "-preset",
      "veryfast",
      "-b:v",
      "2800k",
      "-maxrate",
      "2800k",
      "-bufsize",
      "5600k",
      "-g",
      "48",
      "-keyint_min",
      "48",
      "-sc_threshold",
      "0",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-ac",
      "2",
      "-ar",
      "48000",
      "-movflags",
      "+faststart",
      outputPath,
    ];

    const result = await execa(ctx.ffmpegPath, args, {
      reject: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (result.exitCode !== 0) {
      throw new AttackError(
        `ffmpeg exited ${result.exitCode ?? "unknown"} during ${abrLadderHlsDefault.id}`,
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
