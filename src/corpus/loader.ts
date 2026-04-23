import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { CorpusItem, WatermarkKind } from "../types.js";

/**
 * On-disk schema for `corpus.json`. Kept intentionally small:
 *
 *   - `version`: integer schema version. We only recognise `1` today.
 *   - `items[]`: the corpus. `path` is resolved relative to the *corpus
 *     JSON file's directory* (not cwd), so corpora stay portable.
 *
 * Optional per-item fields (`sha256`, `license`, `source`, `notes`) are
 * retained on the parsed `CorpusItem` so downstream tooling and the
 * signed report can attribute each sample without round-tripping via a
 * separate metadata store.
 */
export interface CorpusFile {
  readonly version: 1;
  readonly description?: string;
  readonly items: readonly CorpusFileItem[];
}

export interface CorpusFileItem {
  readonly id: string;
  readonly label: string;
  readonly path: string;
  readonly expectedWatermarks: readonly WatermarkKind[];
  readonly sha256?: string;
  readonly license?: string;
  readonly source?: string;
  readonly notes?: string;
}

/** Loaded corpus item augmented with fields the runner needs. `CorpusItem`
 *  in `../types.ts` already carries id/label/path/expectedWatermarks; we
 *  extend it structurally so the optional metadata travels alongside. */
export type LoadedCorpusItem = CorpusItem & {
  readonly sha256?: string;
  readonly license?: string;
  readonly source?: string;
};

export interface LoadCorpusOptions {
  /** If true, compute each item's sha256 and verify against any
   *  `sha256` field in the manifest. Fails loudly on mismatch. Default
   *  `false` — hashing every file on every load is wasteful in CI. */
  readonly verifyHashes?: boolean;
}

export class CorpusLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorpusLoadError";
  }
}

/**
 * Load and validate a `corpus.json` file from disk.
 *
 * Resolves each item's `path` relative to the corpus file's containing
 * directory so corpora remain portable across machines.
 */
export async function loadCorpus(
  corpusJsonPath: string,
  opts: LoadCorpusOptions = {},
): Promise<readonly LoadedCorpusItem[]> {
  const absolute = path.resolve(corpusJsonPath);
  const baseDir = path.dirname(absolute);

  let raw: string;
  try {
    raw = await readFile(absolute, "utf8");
  } catch (err) {
    throw new CorpusLoadError(
      `Could not read corpus file ${absolute}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CorpusLoadError(
      `Corpus file ${absolute} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const file = validateCorpusFile(parsed, absolute);

  const ids = new Set<string>();
  const items: LoadedCorpusItem[] = [];
  for (const raw of file.items) {
    const entry = validateCorpusItem(raw, absolute);
    if (ids.has(entry.id)) {
      throw new CorpusLoadError(
        `Duplicate corpus item id \`${entry.id}\` in ${absolute}`,
      );
    }
    ids.add(entry.id);

    const resolvedPath = path.resolve(baseDir, entry.path);
    if (opts.verifyHashes && entry.sha256) {
      const actual = await sha256File(resolvedPath);
      if (actual !== entry.sha256.toLowerCase()) {
        throw new CorpusLoadError(
          `Corpus item \`${entry.id}\` sha256 mismatch: manifest says ${entry.sha256}, file hashed to ${actual}`,
        );
      }
    }

    const loaded: LoadedCorpusItem = {
      id: entry.id,
      label: entry.label,
      path: resolvedPath,
      expectedWatermarks: entry.expectedWatermarks,
      ...(entry.notes !== undefined ? { notes: entry.notes } : {}),
      ...(entry.sha256 !== undefined ? { sha256: entry.sha256 } : {}),
      ...(entry.license !== undefined ? { license: entry.license } : {}),
      ...(entry.source !== undefined ? { source: entry.source } : {}),
    };
    items.push(loaded);
  }

  return items;
}

/**
 * Compute the lowercase hex sha256 of a file. Exposed for callers that
 * want to verify integrity outside `loadCorpus` (e.g. in a regeneration
 * script for `corpus.json`).
 */
export async function sha256File(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

// ---------- validation ----------

const VALID_WATERMARK_KINDS: ReadonlySet<WatermarkKind> = new Set<WatermarkKind>([
  "c2pa",
  "iptc-xmp",
  "synthid",
  "digimarc",
  "truepic",
  "hive",
  "stegastamp",
  "unknown",
]);

function validateCorpusFile(x: unknown, sourcePath: string): CorpusFile {
  if (!isRecord(x)) {
    throw new CorpusLoadError(
      `Corpus file ${sourcePath} must be a JSON object at its root.`,
    );
  }
  if (x["version"] !== 1) {
    throw new CorpusLoadError(
      `Corpus file ${sourcePath} has unknown schema version ${JSON.stringify(x["version"])}; this build only understands version 1.`,
    );
  }
  const items = x["items"];
  if (!Array.isArray(items)) {
    throw new CorpusLoadError(
      `Corpus file ${sourcePath} is missing required \`items\` array.`,
    );
  }
  const out: CorpusFile = {
    version: 1,
    items: items as CorpusFileItem[],
    ...(typeof x["description"] === "string"
      ? { description: x["description"] }
      : {}),
  };
  return out;
}

function validateCorpusItem(x: unknown, sourcePath: string): CorpusFileItem {
  if (!isRecord(x)) {
    throw new CorpusLoadError(
      `Corpus file ${sourcePath}: item is not an object`,
    );
  }
  const id = x["id"];
  const label = x["label"];
  const itemPath = x["path"];
  const expected = x["expectedWatermarks"];

  if (typeof id !== "string" || id.length === 0) {
    throw new CorpusLoadError(
      `Corpus file ${sourcePath}: item missing string \`id\``,
    );
  }
  if (typeof label !== "string" || label.length === 0) {
    throw new CorpusLoadError(
      `Corpus file ${sourcePath}: item \`${id}\` missing string \`label\``,
    );
  }
  if (typeof itemPath !== "string" || itemPath.length === 0) {
    throw new CorpusLoadError(
      `Corpus file ${sourcePath}: item \`${id}\` missing string \`path\``,
    );
  }
  if (!Array.isArray(expected) || expected.length === 0) {
    throw new CorpusLoadError(
      `Corpus file ${sourcePath}: item \`${id}\` needs a non-empty \`expectedWatermarks\` array`,
    );
  }
  for (const w of expected) {
    if (typeof w !== "string" || !VALID_WATERMARK_KINDS.has(w as WatermarkKind)) {
      throw new CorpusLoadError(
        `Corpus file ${sourcePath}: item \`${id}\` has unknown watermark kind \`${String(w)}\``,
      );
    }
  }

  const sha256 = x["sha256"];
  if (sha256 !== undefined && (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(sha256))) {
    throw new CorpusLoadError(
      `Corpus file ${sourcePath}: item \`${id}\` has malformed sha256 \`${String(sha256)}\``,
    );
  }

  const out: CorpusFileItem = {
    id,
    label,
    path: itemPath,
    expectedWatermarks: expected as readonly WatermarkKind[],
    ...(typeof sha256 === "string" ? { sha256: sha256.toLowerCase() } : {}),
    ...(typeof x["license"] === "string" ? { license: x["license"] } : {}),
    ...(typeof x["source"] === "string" ? { source: x["source"] } : {}),
    ...(typeof x["notes"] === "string" ? { notes: x["notes"] } : {}),
  };
  return out;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}
