#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import pc from "picocolors";
import {
  buildJsonReport,
  defaultAttacks,
  defaultDetectors,
  loadCorpus,
  runMatrix,
  writeJsonReport,
  CorpusLoadError,
  type CorpusItem,
} from "../src/index.js";

const USAGE = `ai-watermark-robustness-auditor
Independent test lab for AI watermark robustness (EU AI Act Art. 50(2)).

USAGE
  watermark-audit run [<input>...]          Run the default attack battery against
                                            ad-hoc input files and write a JSON
                                            report to ./reports/.
  watermark-audit run --corpus=<path>       Same, but load inputs from a corpus.json
                                            manifest (id/label/hash/license per-item).
                                            Can be combined with positional inputs.
  watermark-audit list-attacks              Print the registered attack set.
  watermark-audit list-detectors            Print the registered detector set.
  watermark-audit version                   Print the auditor version.
  watermark-audit help                      This text.

OPTIONS
  --corpus=<path>                           Path to a corpus.json manifest.
                                            Paths inside the manifest are resolved
                                            relative to the manifest file.
  --verify-hashes                           With --corpus, recompute sha256 of each
                                            item and fail if any mismatch the
                                            manifest.
  --ffmpeg-path=<path>                      Override ffmpeg location (default: on PATH).

NOTES
  - Requires ffmpeg on PATH. Override with --ffmpeg-path=<path>.
  - The bundled corpus lives in \`corpus/corpus.json\`; run with
    \`--corpus=corpus/corpus.json\` to use it.
`;

interface ParsedArgs {
  readonly command: string;
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean>>;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (const token of rest) {
    if (token.startsWith("--")) {
      const body = token.slice(2);
      const eq = body.indexOf("=");
      if (eq >= 0) {
        flags[body.slice(0, eq)] = body.slice(eq + 1);
      } else {
        flags[body] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { command, positional, flags };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case "help":
    case "-h":
    case "--help":
      process.stdout.write(USAGE);
      return 0;

    case "version":
    case "--version":
    case "-v":
      process.stdout.write("ai-watermark-robustness-auditor 0.0.1\n");
      return 0;

    case "list-attacks":
      for (const a of defaultAttacks) {
        console.log(`  ${pc.cyan(a.id.padEnd(28))}  ${pc.dim(a.category.padEnd(22))}${a.title}`);
      }
      return 0;

    case "list-detectors":
      for (const d of defaultDetectors) {
        console.log(
          `  ${pc.cyan(d.id.padEnd(20))}  ${pc.dim(d.watermarkKind.padEnd(14))}${d.title}`,
        );
      }
      return 0;

    case "run":
      return runCommand(args);

    default:
      process.stderr.write(`Unknown command: ${args.command}\n\n${USAGE}`);
      return 2;
  }
}

async function runCommand(args: ParsedArgs): Promise<number> {
  const corpusFlag = args.flags["corpus"];
  const verifyHashes = args.flags["verify-hashes"] === true;

  if (args.positional.length === 0 && typeof corpusFlag !== "string") {
    process.stderr.write(
      "run requires at least one input file or --corpus=<path>.\n",
    );
    return 2;
  }

  const ffmpegPath =
    typeof args.flags["ffmpeg-path"] === "string"
      ? args.flags["ffmpeg-path"]
      : "ffmpeg";

  const ffmpegVersion = await probeFfmpegVersion(ffmpegPath).catch((err) => {
    process.stderr.write(
      `[error] ffmpeg not usable at \`${ffmpegPath}\`: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return undefined;
  });
  if (!ffmpegVersion) return 2;

  const runId = `run-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const workDir = path.resolve(process.cwd(), "work", runId);
  const reportDir = path.resolve(process.cwd(), "reports");
  await mkdir(reportDir, { recursive: true });

  const corpus: CorpusItem[] = [];

  if (typeof corpusFlag === "string") {
    try {
      const loaded = await loadCorpus(corpusFlag, { verifyHashes });
      for (const item of loaded) {
        corpus.push(item);
      }
    } catch (err) {
      if (err instanceof CorpusLoadError) {
        process.stderr.write(`[error] ${err.message}\n`);
      } else {
        process.stderr.write(
          `[error] Failed to load corpus: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
      return 2;
    }
  }

  // Positional inputs are appended to whatever the corpus manifest loaded,
  // so `run --corpus=default.json extra.mp4` works for ad-hoc additions.
  const manifestIds = new Set(corpus.map((c) => c.id));
  args.positional.forEach((p, idx) => {
    let id = `input-${String(idx + 1).padStart(3, "0")}`;
    while (manifestIds.has(id)) id = `${id}-dup`;
    manifestIds.add(id);
    corpus.push({
      id,
      label: path.basename(p),
      path: path.resolve(p),
      expectedWatermarks: ["unknown"],
    });
  });

  console.log(pc.bold("\nai-watermark-robustness-auditor"));
  console.log(pc.dim(`run id: ${runId}`));
  console.log(pc.dim(`ffmpeg: ${ffmpegVersion}`));
  console.log(pc.dim(`inputs: ${corpus.length}`));
  console.log(pc.dim(`attacks: ${defaultAttacks.length}`));
  console.log(pc.dim(`detectors: ${defaultDetectors.length}`));
  console.log("");

  const report = await runMatrix({
    corpus,
    attacks: [...defaultAttacks],
    detectors: [...defaultDetectors],
    workDir,
    ffmpegPath,
    env: {
      methodologyVersion: "0.0-scaffold",
      auditorVersion: "0.0.1",
      ffmpegVersion,
      os: `${process.platform} ${process.arch}`,
      nodeVersion: process.version,
    },
    onProgress: (event) => {
      switch (event.kind) {
        case "baseline":
          process.stdout.write(
            pc.dim(`  baseline  ${event.inputId}  ${event.detectorId}\n`),
          );
          break;
        case "attack":
          process.stdout.write(
            pc.cyan(`  attack    ${event.inputId}  ${event.attackId}\n`),
          );
          break;
        case "detect":
          process.stdout.write(
            pc.dim(`  detect    ${event.inputId}  ${event.attackId}  ${event.detectorId}\n`),
          );
          break;
      }
    },
  });

  const envelope = buildJsonReport(report, runId);
  const outPath = path.join(reportDir, `${runId}.json`);
  await writeJsonReport(outPath, envelope);

  console.log("");
  console.log(pc.bold("Scores"));
  for (const s of envelope.scores) {
    const pctStr = `${(s.survivalRate * 100).toFixed(1).padStart(5)}%`;
    console.log(
      `  ${s.detectorId.padEnd(24)}  ${pc.bold(s.grade)}  ${pctStr}  (${s.survived}/${s.cellsConsidered})`,
    );
  }
  console.log("");
  console.log(`${pc.green("wrote")} ${outPath}`);
  return 0;
}

async function probeFfmpegVersion(ffmpegPath: string): Promise<string> {
  const res = await execa(ffmpegPath, ["-version"], { reject: false });
  if (res.exitCode !== 0) {
    throw new Error(`ffmpeg -version exited ${res.exitCode}`);
  }
  const first = (res.stdout ?? "").split(/\r?\n/)[0] ?? "unknown";
  return first;
}

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) ||
  (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]);

if (isDirectRun) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
