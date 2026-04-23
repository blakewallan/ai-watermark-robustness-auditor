#!/usr/bin/env node
/**
 * tools/sign-corpus.mjs — sign raw media with a test C2PA manifest so we can
 * add them to the robustness-auditor corpus with known ground truth.
 *
 * Uses @contentauth/c2pa-node's LocalSigner with test credentials that are
 * fetched on demand from the public c2patool repo. Pinned by SHA-256 — any
 * drift aborts the run so a silent upstream swap cannot change signing output.
 *
 * Usage:
 *   node tools/sign-corpus.mjs --fetch-test-creds
 *   node tools/sign-corpus.mjs <input...>
 *
 * See tools/README.md for the full option reference.
 */

import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { dirname, resolve, relative, basename, extname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Builder, LocalSigner } from "@contentauth/c2pa-node";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const CACHE_DIR = join(SCRIPT_DIR, ".cache");

// --- pinned upstream test credentials (c2patool/sample) --------------------
// These are public test credentials that the entire C2PA dev ecosystem uses.
// Not for production — no serious verifier trusts them. Pinning by SHA-256
// means an upstream rotation will be caught by this script before it's used
// to sign anything, so the corpus stays byte-reproducible.
const TEST_CREDS = {
  certs: {
    url: "https://raw.githubusercontent.com/contentauth/c2patool/main/sample/es256_certs.pem",
    sha256: "f18a293626ac261b18201e269ee0ed9c10bc30afb3b5c8708bb16e41a05bf040",
    localPath: join(CACHE_DIR, "es256_certs.pem"),
    bytes: 1836,
  },
  privateKey: {
    url: "https://raw.githubusercontent.com/contentauth/c2patool/main/sample/es256_private.key",
    sha256: "f547ec8dbf24e50b51cf9924e58c250d246ed8844304408a072801fcf70a95d7",
    localPath: join(CACHE_DIR, "es256_private.key"),
    bytes: 241,
  },
};

const MIME_BY_EXT = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".avif": "image/avif",
  ".pdf": "application/pdf",
};

function die(msg, code = 1) {
  process.stderr.write(`sign-corpus: ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = {
    output: "corpus/local-signed",
    sourceTag: "local-signed",
    key: TEST_CREDS.privateKey.localPath,
    cert: TEST_CREDS.certs.localPath,
    alg: "es256",
    author: "Robustness Corpus",
    claimGenerator: undefined,
    sourceUrl: "",
    license: "proprietary",
    digitalSourceType:
      "https://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture",
    verify: false,
    fetchTestCreds: false,
    help: false,
    positional: [],
  };
  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") {
      opts.help = true;
    } else if (raw === "--verify") {
      opts.verify = true;
    } else if (raw === "--fetch-test-creds") {
      opts.fetchTestCreds = true;
    } else if (raw.startsWith("--output=")) {
      opts.output = raw.slice("--output=".length);
    } else if (raw.startsWith("--source-tag=")) {
      opts.sourceTag = raw.slice("--source-tag=".length);
    } else if (raw.startsWith("--key=")) {
      opts.key = raw.slice("--key=".length);
    } else if (raw.startsWith("--cert=")) {
      opts.cert = raw.slice("--cert=".length);
    } else if (raw.startsWith("--alg=")) {
      opts.alg = raw.slice("--alg=".length);
    } else if (raw.startsWith("--author=")) {
      opts.author = raw.slice("--author=".length);
    } else if (raw.startsWith("--claim-generator=")) {
      opts.claimGenerator = raw.slice("--claim-generator=".length);
    } else if (raw.startsWith("--source-url=")) {
      opts.sourceUrl = raw.slice("--source-url=".length);
    } else if (raw.startsWith("--license=")) {
      opts.license = raw.slice("--license=".length);
    } else if (raw.startsWith("--digital-source=")) {
      opts.digitalSourceType = raw.slice("--digital-source=".length);
    } else if (raw.startsWith("--")) {
      die(`unknown flag: ${raw} (use --help for reference)`, 2);
    } else {
      opts.positional.push(raw);
    }
  }
  return opts;
}

function printHelp() {
  process.stdout.write(`tools/sign-corpus.mjs — sign media with a test C2PA manifest

usage:
  node tools/sign-corpus.mjs --fetch-test-creds
  node tools/sign-corpus.mjs [options] <input-path...>

positional args may be individual files or directories; directories are
walked recursively for any file with a recognised media extension.

options:
  --output=<dir>         output directory (default: corpus/local-signed)
  --source-tag=<name>    corpus-fragment.json 'source' tag (default: local-signed)
  --key=<path>           ES256 private-key PEM; default uses cached test creds
  --cert=<path>          cert chain PEM; default uses cached test creds
  --alg=<es256|ps256|..> c2pa-node SigningAlg (default: es256)
  --author=<name>        name embedded in stds.schema-org.CreativeWork author
  --claim-generator=<s>  override the default claim_generator string
  --source-url=<url>     URL written into each corpus-fragment entry's source
  --license=<tag>        license tag (default: proprietary)
  --digital-source=<url> IPTC digitalSourceType URI (default: digitalCapture)
  --verify               run c2pa-manifest-validator over each signed output
  --fetch-test-creds     download and verify pinned test creds, then exit
  --help                 show this message

examples:
  # one-time bootstrap:
  node tools/sign-corpus.mjs --fetch-test-creds

  # sign every media file in a raw dir:
  node tools/sign-corpus.mjs \\
    --output=corpus/camera-control \\
    --source-tag=camera-control \\
    --author="Blake's phone" \\
    --digital-source=https://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture \\
    ~/raw-clips/

  # sign a handful and verify each one parses back:
  node tools/sign-corpus.mjs --verify foo.mp4 bar.mov

credentials:
  defaults use public test credentials from contentauth/c2patool, cached at
  tools/.cache/ after --fetch-test-creds. every sign run hash-checks the
  cache against pinned SHA-256s in this script and aborts on mismatch.
`);
}

function sha256OfBuffer(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function fetchTestCreds() {
  mkdirSync(CACHE_DIR, { recursive: true });
  for (const [name, spec] of Object.entries(TEST_CREDS)) {
    process.stdout.write(`fetching ${name} from ${spec.url} ... `);
    const res = await fetch(spec.url);
    if (!res.ok) {
      die(`\nfetch failed (${res.status} ${res.statusText})`);
    }
    const body = Buffer.from(await res.arrayBuffer());
    const actualSha = sha256OfBuffer(body);
    if (actualSha !== spec.sha256) {
      die(
        `\nsha256 mismatch for ${name}:\n` +
          `  expected ${spec.sha256}\n` +
          `  got      ${actualSha}\n` +
          `an upstream rotation has likely happened. refusing to cache. ` +
          `review the file at ${spec.url} by hand, update the TEST_CREDS pin ` +
          `in tools/sign-corpus.mjs if trust is established, then re-run.`,
      );
    }
    if (body.length !== spec.bytes) {
      die(`\nbyte-length mismatch for ${name}: expected ${spec.bytes}, got ${body.length}`);
    }
    writeFileSync(spec.localPath, body);
    process.stdout.write(`ok (${body.length} bytes, sha256 ${actualSha.slice(0, 12)}…)\n`);
  }
  process.stdout.write(
    `test credentials cached under ${relative(REPO_ROOT, CACHE_DIR)}/.\n` +
      `these are public test creds, NOT FOR PRODUCTION.\n`,
  );
}

function loadCredsOrDie(opts) {
  for (const [label, p, pin] of [
    ["cert", opts.cert, TEST_CREDS.certs],
    ["key", opts.key, TEST_CREDS.privateKey],
  ]) {
    if (!existsSync(p)) {
      const isDefault = p === pin.localPath;
      die(
        `cannot read ${label} at ${p}` +
          (isDefault
            ? "\nrun `node tools/sign-corpus.mjs --fetch-test-creds` first, or pass --cert=/--key= to use your own credentials."
            : ""),
      );
    }
  }
  const certBuf = readFileSync(opts.cert);
  const keyBuf = readFileSync(opts.key);
  if (
    opts.cert === TEST_CREDS.certs.localPath &&
    sha256OfBuffer(certBuf) !== TEST_CREDS.certs.sha256
  ) {
    die(`cached cert at ${opts.cert} has unexpected sha256. re-fetch with --fetch-test-creds.`);
  }
  if (
    opts.key === TEST_CREDS.privateKey.localPath &&
    sha256OfBuffer(keyBuf) !== TEST_CREDS.privateKey.sha256
  ) {
    die(`cached key at ${opts.key} has unexpected sha256. re-fetch with --fetch-test-creds.`);
  }
  return { certBuf, keyBuf };
}

function collectInputs(paths) {
  const out = [];
  for (const p of paths) {
    const abs = resolve(p);
    if (!existsSync(abs)) die(`input not found: ${p}`);
    const st = statSync(abs);
    if (st.isDirectory()) {
      walkDir(abs, out);
    } else if (st.isFile()) {
      if (MIME_BY_EXT[extname(abs).toLowerCase()]) {
        out.push(abs);
      } else {
        process.stderr.write(`warn: skipping ${p} (unsupported extension)\n`);
      }
    }
  }
  return out;
}

function walkDir(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, out);
    } else if (entry.isFile() && MIME_BY_EXT[extname(entry.name).toLowerCase()]) {
      out.push(full);
    }
  }
}

function buildManifest(opts, format, title) {
  const templatePath = join(SCRIPT_DIR, "manifest.template.json");
  const raw = readFileSync(templatePath, "utf-8");
  const substituted = raw
    .replaceAll("{{format}}", format)
    .replaceAll("{{title}}", title.replaceAll('"', '\\"'))
    .replaceAll("{{author}}", opts.author.replaceAll('"', '\\"'))
    .replaceAll("{{digitalSourceType}}", opts.digitalSourceType);
  const manifest = JSON.parse(substituted);
  if (opts.claimGenerator) manifest.claim_generator = opts.claimGenerator;
  return manifest;
}

async function validateOne(signedPath) {
  const bin =
    process.env["C2PA_VALIDATE_BIN"] ??
    "node ../c2pa-manifest-validator/dist/bin/c2pa-validate.js";
  const { spawn } = await import("node:child_process");
  return await new Promise((resolveP) => {
    const parts = bin.split(/\s+/);
    const cmd = parts[0];
    const args = [...parts.slice(1), signedPath, "--json"];
    const proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let out = "";
    let err = "";
    proc.stdout.on("data", (c) => (out += c));
    proc.stderr.on("data", (c) => (err += c));
    proc.on("error", (e) =>
      resolveP({ ok: false, reason: `spawn failed: ${e.message}` }),
    );
    proc.on("exit", (code) => {
      try {
        const report = JSON.parse(out);
        resolveP({
          ok: true,
          errors: report?.counts?.error ?? -1,
          warnings: report?.counts?.warning ?? -1,
          exitCode: code,
        });
      } catch {
        resolveP({
          ok: false,
          reason: `validator did not emit JSON (exit ${code}): ${err.trim().slice(-200)}`,
        });
      }
    });
  });
}

async function signOne(opts, certBuf, keyBuf, inputAbs, inputRootAbs) {
  const rel = relative(inputRootAbs, inputAbs) || basename(inputAbs);
  const outputRel = rel.split(sep).join("/");
  const outputAbs = resolve(opts.output, outputRel);
  mkdirSync(dirname(outputAbs), { recursive: true });
  const format = MIME_BY_EXT[extname(inputAbs).toLowerCase()];
  const title = basename(inputAbs);
  const manifest = buildManifest(opts, format, title);
  const signer = LocalSigner.newSigner(certBuf, keyBuf, opts.alg);
  const t0 = Date.now();
  Builder.withJson(manifest).signFile(signer, inputAbs, {
    path: outputAbs,
    format,
  });
  const durationMs = Date.now() - t0;
  const outBuf = readFileSync(outputAbs);
  const outSha = sha256OfBuffer(outBuf);
  const id = `${opts.sourceTag}-${title
    .replace(extname(title), "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")}`;
  const pathRelToCorpus = relative(
    resolve(REPO_ROOT, "corpus"),
    outputAbs,
  ).split(sep).join("/");
  let verification = null;
  if (opts.verify) {
    verification = await validateOne(outputAbs);
  }
  return {
    id,
    label: `${opts.sourceTag} / ${title}`,
    path: pathRelToCorpus,
    expectedWatermarks: ["c2pa"],
    license: opts.license,
    source: opts.sourceUrl || `local:${opts.sourceTag}`,
    sha256: outSha,
    notes: `Signed by tools/sign-corpus.mjs with public test credentials. Input: ${basename(
      inputAbs,
    )} (${statSync(inputAbs).size} B). Signed in ${durationMs} ms.`,
    _verification: verification,
  };
}

function writeFragment(outputDir, items, opts) {
  mkdirSync(outputDir, { recursive: true });
  const fragment = {
    version: 1,
    description:
      `Corpus fragment produced by tools/sign-corpus.mjs on ` +
      `${new Date().toISOString()}. Append these entries into corpus/corpus.json ` +
      `to include them in the default corpus.`,
    sourceTag: opts.sourceTag,
    signingCredentials:
      opts.cert === TEST_CREDS.certs.localPath
        ? "public test credentials from contentauth/c2patool (NOT production)"
        : `user-supplied (${opts.cert}, ${opts.key})`,
    items: items.map(({ _verification, ...rest }) => rest),
  };
  const fragPath = join(outputDir, "corpus-fragment.json");
  writeFileSync(fragPath, JSON.stringify(fragment, null, 2) + "\n");
  return fragPath;
}

function writeNotice(outputDir, opts, items) {
  const noticePath = join(outputDir, "NOTICE.md");
  const body = `# \`${opts.sourceTag}\` — locally-signed corpus subtree

Generated by \`tools/sign-corpus.mjs\` on ${new Date().toISOString()}.

${items.length} file${items.length === 1 ? "" : "s"} signed with ${
    opts.cert === TEST_CREDS.certs.localPath
      ? "public test credentials from [contentauth/c2patool](https://github.com/contentauth/c2patool/tree/main/sample) (NOT FOR PRODUCTION)"
      : `user-supplied credentials (${opts.cert}, ${opts.key})`
  }.

## Licence

${
  opts.license === "proprietary"
    ? "This subtree is not intended for redistribution. Keep it local unless you have rights to the source material."
    : `License tag: \`${opts.license}\`. Ensure this is compatible with the source media's rights before redistributing.`
}

## Inventory

| id | bytes | sha256 |
| --- | ---: | --- |
${items
  .map(
    (it) =>
      `| \`${it.id}\` | ${statSync(
        resolve(REPO_ROOT, "corpus", it.path),
      ).size.toLocaleString("en-US")} | \`${it.sha256}\` |`,
  )
  .join("\n")}
`;
  writeFileSync(noticePath, body);
  return noticePath;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }
  if (opts.fetchTestCreds) {
    await fetchTestCreds();
    return;
  }
  if (opts.positional.length === 0) {
    printHelp();
    die("no input paths given", 2);
  }

  const { certBuf, keyBuf } = loadCredsOrDie(opts);
  const inputs = collectInputs(opts.positional);
  if (inputs.length === 0) die("no media files found in the given inputs");

  const inputRootAbs =
    opts.positional.length === 1 && statSync(resolve(opts.positional[0])).isDirectory()
      ? resolve(opts.positional[0])
      : resolve(opts.positional[0]).split(sep).slice(0, -1).join(sep);

  const items = [];
  for (const inputAbs of inputs) {
    process.stdout.write(`signing ${relative(REPO_ROOT, inputAbs)} ... `);
    try {
      const item = await signOne(opts, certBuf, keyBuf, inputAbs, inputRootAbs);
      items.push(item);
      const v = item._verification;
      if (v) {
        if (!v.ok) {
          process.stdout.write(`signed but VERIFY FAILED: ${v.reason}\n`);
        } else {
          process.stdout.write(
            `ok (sha256 ${item.sha256.slice(0, 12)}…, verify: ${v.errors} errors / ${v.warnings} warnings)\n`,
          );
        }
      } else {
        process.stdout.write(`ok (sha256 ${item.sha256.slice(0, 12)}…)\n`);
      }
    } catch (e) {
      process.stdout.write(`FAIL: ${e?.message ?? e}\n`);
    }
  }

  if (items.length === 0) die("signed 0 files; nothing to write");

  const fragPath = writeFragment(resolve(opts.output), items, opts);
  const noticePath = writeNotice(resolve(opts.output), opts, items);
  process.stdout.write(
    `\nsigned ${items.length} file${items.length === 1 ? "" : "s"} under ${relative(
      REPO_ROOT,
      resolve(opts.output),
    )}/\n` +
      `  ${relative(REPO_ROOT, fragPath)}  (merge into corpus/corpus.json)\n` +
      `  ${relative(REPO_ROOT, noticePath)}  (license + inventory)\n`,
  );
}

main().catch((e) => die(`unhandled error: ${e?.stack ?? e}`));
