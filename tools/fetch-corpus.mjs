#!/usr/bin/env node
// Regenerate the test corpus. Synth items rebuild from ffmpeg lavfi
// sources (semantically reproducible; SHA-256 drifts across ffmpeg
// versions). External items print a NOTICE pointing at upstream.
// Usage: node tools/fetch-corpus.mjs [--force] [--check] [--only=synth|synth-xmp|external]
// TODO: once a corpus-v1.tar.gz release asset exists, try release URL
// first for byte-exact parity with sample-run.json; fall back to regen.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const CORPUS = join(REPO_ROOT, "corpus");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const flags = {
  force: argv.includes("--force"),
  check: argv.includes("--check"),
  only: (argv.find((a) => a.startsWith("--only=")) || "").slice(7) || null,
};

// ---------------------------------------------------------------------------
// Synthetic corpus recipes — all items produced from ffmpeg lavfi sources
// (testsrc2, mandelbrot, smptebars, cellauto, rgbtestsrc2, sine). These
// are the 12 items in corpus/synth/.
// ---------------------------------------------------------------------------

const COMMON_BITEXACT = ["-fflags", "+bitexact", "-flags", "+bitexact"];

/** @type {{ file: string, args: string[] }[]} */
const SYNTH_RECIPES = [
  {
    file: "synth-1080p30-testsrc2-5s.mp4",
    args: [
      ...COMMON_BITEXACT,
      "-f", "lavfi", "-i", "testsrc2=duration=5:size=1920x1080:rate=30",
      "-c:v", "libx264", "-preset", "medium", "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
    ],
  },
  {
    file: "synth-1080p30-h265-testsrc2-5s.mp4",
    args: [
      ...COMMON_BITEXACT,
      "-f", "lavfi", "-i", "testsrc2=duration=5:size=1920x1080:rate=30",
      "-c:v", "libx265", "-preset", "medium", "-crf", "28",
      "-pix_fmt", "yuv420p",
      "-x265-params", "log-level=error",
      "-tag:v", "hvc1",
      "-movflags", "+faststart",
    ],
  },
  {
    file: "synth-480p30-testsrc2-5s.mp4",
    args: [
      ...COMMON_BITEXACT,
      "-f", "lavfi", "-i", "testsrc2=duration=5:size=854x480:rate=30",
      "-c:v", "libx264", "-preset", "medium", "-crf", "23",
      "-pix_fmt", "yuv420p",
    ],
  },
  {
    file: "synth-240p24-testsrc2-3s.mp4",
    args: [
      ...COMMON_BITEXACT,
      "-f", "lavfi", "-i", "testsrc2=duration=3:size=426x240:rate=24",
      "-c:v", "libx264", "-preset", "medium", "-crf", "23",
      "-pix_fmt", "yuv420p",
    ],
  },
  {
    file: "synth-720p30-mandelbrot-5s.mp4",
    args: [
      ...COMMON_BITEXACT,
      "-f", "lavfi", "-i", "mandelbrot=size=1280x720:rate=30",
      "-t", "5",
      "-c:v", "libx264", "-preset", "medium", "-crf", "23",
      "-pix_fmt", "yuv420p",
    ],
  },
  {
    file: "synth-720p60-smptebars-3s.mp4",
    args: [
      ...COMMON_BITEXACT,
      "-f", "lavfi", "-i", "smptebars=size=1280x720:rate=60",
      "-t", "3",
      "-c:v", "libx264", "-preset", "medium", "-crf", "23",
      "-pix_fmt", "yuv420p",
    ],
  },
  {
    file: "synth-long-720p30-testsrc2-15s.mp4",
    args: [
      ...COMMON_BITEXACT,
      "-f", "lavfi", "-i", "testsrc2=duration=15:size=1280x720:rate=30",
      "-c:v", "libx264", "-preset", "medium", "-crf", "23",
      "-pix_fmt", "yuv420p",
    ],
  },
  {
    file: "synth-square-720-cellauto-5s.mp4",
    args: [
      ...COMMON_BITEXACT,
      "-f", "lavfi",
      "-i", "cellauto=rule=110:size=720x720:rate=30:random_fill_ratio=0.05",
      "-t", "5",
      "-c:v", "libx264", "-preset", "medium", "-crf", "23",
      "-pix_fmt", "yuv420p",
    ],
  },
  {
    file: "synth-vertical-720x1280-rgbtestsrc-5s.mp4",
    args: [
      ...COMMON_BITEXACT,
      "-f", "lavfi",
      "-i", "rgbtestsrc=size=720x1280:rate=30",
      "-t", "5",
      "-c:v", "libx264", "-preset", "medium", "-crf", "23",
      "-pix_fmt", "yuv420p",
    ],
  },
  {
    file: "synth-audio-only-aac-10s.m4a",
    args: [
      ...COMMON_BITEXACT,
      "-f", "lavfi", "-i", "sine=frequency=440:duration=10:sample_rate=48000",
      "-c:a", "aac", "-b:a", "128k",
    ],
  },
  {
    file: "synth-png-testsrc2-512.png",
    args: [
      ...COMMON_BITEXACT,
      "-f", "lavfi", "-i", "testsrc2=size=512x512:rate=1",
      "-frames:v", "1",
    ],
  },
  {
    file: "synth-webp-mandelbrot-512.webp",
    args: [
      ...COMMON_BITEXACT,
      "-f", "lavfi", "-i", "mandelbrot=size=512x512:rate=1",
      "-frames:v", "1",
      "-c:v", "libwebp", "-lossless", "0", "-q:v", "80",
    ],
  },
];

// ---------------------------------------------------------------------------
// Synth-XMP recipes — a minimal base clip then exiftool XMP injection.
// XMP DigitalSourceType values are the IPTC controlled vocabulary:
//   http://cv.iptc.org/newscodes/digitalsourcetype/<classification>
// ---------------------------------------------------------------------------

/** @type {{ file: string, dst: string, base: string[] }[]} */
const SYNTH_XMP_RECIPES = [
  {
    file: "synth-xmp-algorithmic.jpg",
    dst: "http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia",
    base: [
      ...COMMON_BITEXACT,
      "-f", "lavfi", "-i", "testsrc2=size=640x480:rate=1",
      "-frames:v", "1",
      "-q:v", "6",
    ],
  },
  {
    // Negative control — marked as straight digital capture, not AI.
    file: "synth-xmp-capture-video.mp4",
    dst: "http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture",
    base: [
      ...COMMON_BITEXACT,
      "-f", "lavfi", "-i", "testsrc2=duration=3:size=640x480:rate=30",
      "-c:v", "libx264", "-preset", "medium", "-crf", "23",
      "-pix_fmt", "yuv420p",
    ],
  },
  {
    file: "synth-xmp-composite-video.mp4",
    dst: "http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia",
    base: [
      ...COMMON_BITEXACT,
      "-f", "lavfi", "-i", "mandelbrot=size=640x480:rate=30",
      "-t", "3",
      "-c:v", "libx264", "-preset", "medium", "-crf", "23",
      "-pix_fmt", "yuv420p",
    ],
  },
  {
    file: "synth-xmp-trained-video.mp4",
    dst: "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
    base: [
      ...COMMON_BITEXACT,
      "-f", "lavfi", "-i", "testsrc2=duration=3:size=640x480:rate=30",
      "-c:v", "libx264", "-preset", "medium", "-crf", "23",
      "-pix_fmt", "yuv420p",
    ],
  },
];

// ---------------------------------------------------------------------------
// External corpus items — assets we don't synthesise. For now the script
// does not download these automatically because the canonical URLs have
// historically moved around; it prints a stable NOTICE so an operator can
// fetch them once and drop them into place. Once a GitHub Release is
// cut on this repo, these should be moved to release-asset URLs with
// SHA-256 pins and downloaded automatically (see top-of-file TODO).
// ---------------------------------------------------------------------------

/**
 * @type {{
 *   dir: string,
 *   file: string,
 *   upstream: string,
 *   note: string,
 * }[]}
 */
const EXTERNAL_ITEMS = [
  {
    dir: "c2pa-org-public",
    file: "truepic-20230212-zoetrope.mp4",
    upstream: "https://c2pa.org/public-testfiles/ (Truepic zoetrope, Feb 2023)",
    note:
      "Public C2PA conformance-test video. ~15 MB. Drop into " +
      "corpus/c2pa-org-public/ after download.",
  },
  {
    dir: "adobe-c2pa-js",
    file: "C.jpg",
    upstream: "https://github.com/contentauth/c2pa-js",
    note: "Adobe c2pa-js sample pack. All six files go into corpus/adobe-c2pa-js/.",
  },
  {
    dir: "adobe-c2pa-js",
    file: "C_with_CAWG_data.jpg",
    upstream: "https://github.com/contentauth/c2pa-js",
    note: "CAWG metadata sample.",
  },
  {
    dir: "adobe-c2pa-js",
    file: "C_with_CAWG_data_thumbnail.jpg",
    upstream: "https://github.com/contentauth/c2pa-js",
    note: "CAWG thumbnail.",
  },
  {
    dir: "adobe-c2pa-js",
    file: "dash1.m4s",
    upstream: "https://github.com/contentauth/c2pa-js",
    note: "DASH fMP4 segment.",
  },
  {
    dir: "adobe-c2pa-js",
    file: "dashinit.mp4",
    upstream: "https://github.com/contentauth/c2pa-js",
    note: "DASH init segment.",
  },
  {
    dir: "adobe-c2pa-js",
    file: "no_alg.jpg",
    upstream: "https://github.com/contentauth/c2pa-js",
    note: "Negative-control image (no alg tag).",
  },
  {
    dir: "adobe-c2pa-js",
    file: "PirateShip_save_credentials_to_cloud.jpg",
    upstream: "https://github.com/contentauth/c2pa-js",
    note: "Ignore the filename, this is a demo image.",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Spawn a subprocess and resolve with stdout/stderr and exit code.
 * Writes the child's stderr straight through so ffmpeg/exiftool errors
 * land in the operator's console in real time.
 */
function run(cmd, args, opts = {}) {
  return new Promise((resolveFn, rejectFn) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "inherit"],
      shell: process.platform === "win32",
      ...opts,
    });
    const chunks = [];
    child.stdout.on("data", (c) => chunks.push(c));
    child.on("error", rejectFn);
    child.on("close", (code) => {
      if (code !== 0) {
        rejectFn(
          new Error(
            `${cmd} ${args.join(" ")} exited ${code}`,
          ),
        );
        return;
      }
      resolveFn(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

function sha256Of(path) {
  const h = createHash("sha256");
  h.update(readFileSync(path));
  return h.digest("hex");
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function log(msg) {
  process.stdout.write(`[fetch-corpus] ${msg}\n`);
}

function warn(msg) {
  process.stderr.write(`[fetch-corpus] ! ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Stage runners
// ---------------------------------------------------------------------------

async function regenSynth() {
  const outDir = join(CORPUS, "synth");
  ensureDir(outDir);
  let built = 0;
  let skipped = 0;
  for (const recipe of SYNTH_RECIPES) {
    const out = join(outDir, recipe.file);
    if (!flags.force && existsSync(out) && statSync(out).size > 0) {
      skipped += 1;
      continue;
    }
    log(`ffmpeg → synth/${recipe.file}`);
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error",
      ...recipe.args, out]);
    built += 1;
  }
  log(`synth: ${built} built, ${skipped} already present`);
}

async function regenSynthXmp() {
  const outDir = join(CORPUS, "synth-xmp");
  ensureDir(outDir);
  let built = 0;
  let skipped = 0;
  for (const recipe of SYNTH_XMP_RECIPES) {
    const out = join(outDir, recipe.file);
    if (!flags.force && existsSync(out) && statSync(out).size > 0) {
      skipped += 1;
      continue;
    }
    log(`ffmpeg + exiftool → synth-xmp/${recipe.file}`);
    // 1. ffmpeg-generate the base media
    await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error",
      ...recipe.base, out]);
    // 2. inject XMP DigitalSourceType via exiftool
    //    -overwrite_original: modify in place (no _original sidecar)
    //    -XMP-iptcExt:DigitalSourceType=<uri>: the iptc-ext namespace
    //      tag that every DST-aware reader (including ours) looks at
    await run("exiftool", [
      "-overwrite_original",
      `-XMP-iptcExt:DigitalSourceType=${recipe.dst}`,
      out,
    ]);
    built += 1;
  }
  log(`synth-xmp: ${built} built, ${skipped} already present`);
}

function reportExternal() {
  let missing = 0;
  for (const item of EXTERNAL_ITEMS) {
    const target = join(CORPUS, item.dir, item.file);
    if (existsSync(target) && statSync(target).size > 0) continue;
    missing += 1;
    warn(
      `missing external asset: corpus/${item.dir}/${item.file}\n` +
      `    upstream: ${item.upstream}\n` +
      `    ${item.note}`,
    );
  }
  if (missing === 0) {
    log("external: all upstream assets present");
  } else {
    warn(
      `external: ${missing} asset(s) not on disk. The attack battery ` +
      "will still run on the synth / synth-xmp subsets without them, " +
      "but the published sample-run numbers assume the full corpus.",
    );
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  log(`repo root: ${REPO_ROOT}`);

  if (flags.check) {
    // Just tally what's on disk; don't regenerate.
    const total =
      SYNTH_RECIPES.length + SYNTH_XMP_RECIPES.length + EXTERNAL_ITEMS.length;
    let present = 0;
    for (const r of SYNTH_RECIPES)
      if (existsSync(join(CORPUS, "synth", r.file))) present += 1;
    for (const r of SYNTH_XMP_RECIPES)
      if (existsSync(join(CORPUS, "synth-xmp", r.file))) present += 1;
    for (const e of EXTERNAL_ITEMS)
      if (existsSync(join(CORPUS, e.dir, e.file))) present += 1;
    log(`--check: ${present} / ${total} items on disk`);
    process.exit(present === total ? 0 : 1);
  }

  const only = flags.only;
  if (!only || only === "synth") await regenSynth();
  if (!only || only === "synth-xmp") await regenSynthXmp();
  let externalMissing = 0;
  if (!only || only === "external") externalMissing = reportExternal();

  log("done.");
  process.exit(externalMissing > 0 ? 1 : 0);
}

main().catch((e) => {
  warn(`fatal: ${e.message}`);
  process.exit(1);
});
