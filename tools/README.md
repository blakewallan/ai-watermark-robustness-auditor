# `tools/`

Small operator scripts. Not part of the published npm package.

## `sign-corpus.mjs` — generate signed corpus items from raw media

The bundled `corpus/` has only one decodable signed MP4 (Truepic zoetrope).
To publish a robustness report with n > 1 video, sign a few of your own
clips with this tool and add them to `corpus.json`.

### One-time setup — fetch the test credentials

```
node tools/sign-corpus.mjs --fetch-test-creds
```

This downloads the public test credentials bundled with
[`contentauth/c2patool`](https://github.com/contentauth/c2patool/tree/main/sample)
into `tools/.cache/`. The script pins both files by SHA-256 — an upstream
swap will fail the fetch loudly rather than silently changing what gets
signed.

**These are explicitly non-production test credentials.** Every C2PA tool
treats them as untrusted; no real verifier accepts their chain. They exist
to produce structurally-valid C2PA manifests for dev and corpus work.

The cache directory is git-ignored.

### Sign a directory of raw clips

```
node tools/sign-corpus.mjs \
  --output=corpus/camera-control \
  --source-tag=camera-control \
  --author="Blake's Pixel 8" \
  --digital-source=https://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture \
  --verify \
  ~/OneDrive/raw-clips/2026-04-daylight/
```

Per file, the script:

1. Substitutes a minimal but compliance-friendly C2PA manifest template
   (`tools/manifest.template.json`) — `c2pa.actions`, `stds.schema-org.CreativeWork`,
   `c2pa.training-mining` (all `notAllowed` by default), and a
   `c2pa.digital-source-type` assertion.
2. Signs via `@contentauth/c2pa-node`'s `LocalSigner` + `Builder.signFile`
   using the test creds (or your own via `--key=` / `--cert=`).
3. Computes `sha256` of the output bytes and builds a corpus fragment entry
   with `id`, `path`, `expectedWatermarks`, `license`, `source`, `sha256`,
   `notes`.
4. Optionally (`--verify`) pipes the output through
   `c2pa-manifest-validator` to confirm the signed asset parses.

At the end, writes:

- `<output>/corpus-fragment.json` — an array of ready-to-paste entries.
- `<output>/NOTICE.md` — license tag + per-file inventory.

### Merge into the corpus

Open `corpus/corpus.json` and append each object from `corpus-fragment.json`'s
`items[]` into the main `items[]`. Then:

```
npm run build
node dist/bin/watermark-audit.js run --corpus=corpus/corpus.json --verify-hashes
```

`--verify-hashes` recomputes sha256 for every item on load and aborts on
mismatch, so a merged entry that doesn't match its written sha256 will fail
loud.

### Use your own credentials

```
node tools/sign-corpus.mjs \
  --key=/path/to/your.key \
  --cert=/path/to/your-chain.pem \
  --alg=ps256 \
  raw-clip.mp4
```

Supported algorithms are whatever `@contentauth/c2pa-node`'s `SigningAlg`
union accepts: `es256`, `es384`, `es512`, `ps256`, `ps384`, `ps512`,
`ed25519`.

### What the signed output looks like against the detector

A smoke run against a signed test file shows our own `detector.c2pa` returns
`detected=true` at 0.5 confidence. The 0.5 (rather than 1.0) is because
the validator's strict 2.3 rules flag some baseline compliance issues
(e.g. claim-generator formatting, digital-source-type requirements for the
`c2pa.created` action). Those stay constant across the baseline and the
attack runs, so they do not bias the attack-survival measurement — they
only show up as a stable suffix on every row of the report.

If you need a clean 1.0-confidence baseline for a specific publication,
extend `manifest.template.json` with whatever additional assertions your
target validator configuration demands.

### Why this script bundles no credentials

- Committing any signing key into a public repo is a long-standing bad
  smell even for known-public test keys.
- Pinned on-demand fetch (`--fetch-test-creds`) gives us two wins:
  integrity-verified content (SHA-256 check) and a single source of truth
  (whoever CAI says the test creds are, today).
- The tool still works with user-supplied credentials via `--key=` / `--cert=`
  for anyone who wants to sign with their own chain.
