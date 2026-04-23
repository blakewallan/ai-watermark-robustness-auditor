# ai-watermark-robustness-auditor

**Independent test lab for AI watermark and content-credential robustness.**

Given a watermarked video, run a standardized attack battery — re-encode,
platform-upload simulation, screen capture, crop, ABR ladder, filter chains —
and emit a signed robustness-score report mapped to the EU AI Act Art. 50(2)
"effective, interoperable, robust, and reliable" language.

Status: **v0.0 scaffold, plus first two-detector / five-attack run.** Five
attacks (re-encode, YouTube-1080p platform-sim, HLS 720p VOD-ladder, C2PA
`uuid`-box strip, XMP packet strip) and two detectors (C2PA manifest, IPTC
XMP `DigitalSourceType`) are wired end-to-end. On a 24-item corpus
([`corpus/corpus.json`](corpus/corpus.json): 7 Adobe `c2pa-js` samples, 1
real Truepic-signed MP4 from `c2pa-org/public-testfiles`, 12 ffmpeg-synthetic
C2PA-only clips, and 4 ffmpeg-synthetic clips carrying **both** a C2PA
manifest and an `Iptc4xmpExt:DigitalSourceType` XMP packet injected pre-signing):

| Detector | Applicable | Survived | Grade |
|---|---:|---:|:---:|
| `detector.c2pa` | 91 | 19 (20.9 %) | **F** |
| `detector.xmp-dst` | 19 | 3 (15.8 %) | **F** |

**The headline finding — orthogonal failure modes.** Per-attack survival
on the 4 `synth-xmp/` items that carry *both* disclosure mechanisms:

|                         | `detector.c2pa`            | `detector.xmp-dst`         |
|-------------------------|:--------------------------:|:--------------------------:|
| `container.strip.c2pa`  | 0 / 3 survived (**0 %**)   | 3 / 3 survived (**100 %**) |
| `container.strip.xmp`   | 3 / 3 survived (**100 %**) ¹ | 0 / 4 survived (**0 %**)   |

¹ *C2PA manifest survives structurally (detector confidence 0.5); the
hard-binding hash is invalidated because the signed bytes no longer
match. See [METHODOLOGY §A5](docs/METHODOLOGY.md#a5--strip-xmp-packets-containerstripxmp) for what "present but broken" means in the
validator's policy layer.*

Each surgical-strip attack destroys its own target almost perfectly while
leaving the *other* signal intact — the textbook orthogonal failure
surface. Platform-sim and generic re-encode, by contrast, destroy both
disclosures uniformly (0 % survival across all 4 re-encode-style rows).
Operational conclusion: a claim of "robust AI disclosure" has to specify
*which* disclosure channel and against *which* transformation. The
mechanisms are not interchangeable, and a defender who relies on only
one is one line of ffmpeg or ten bytes of hex-editor time away from
losing the signal.

Full matrix (24 × 5 × 3 = 360 cells) runs in ~45 seconds on a consumer
laptop. See [`reports/sample-run.json`](reports/sample-run.json) for the
canonical reference report.

---

## Why this exists

EU AI Act **Article 50(2)** (enforceable 2 August 2026):

> Providers of AI systems, including general-purpose AI systems, generating
> synthetic audio, image, video or text content, shall ensure that the
> outputs of the AI system are marked in a machine-readable format and
> detectable as artificially generated or manipulated. [...] The technical
> solutions shall be **effective, interoperable, robust and reliable** as
> far as technically feasible.

Every AI video vendor — Google (SynthID on Veo), OpenAI (C2PA on Sora),
Meta (invisible marks on Movie Gen), Adobe (Firefly Content Credentials),
Runway, Pika, Kling, Luma — claims their disclosure is **robust**. Academic
papers have shown many are not robust to even a single platform re-upload.

**Nobody independently tests the vendor claims.** This project does.

---

## What it produces

A signed report containing:

1. **The corpus under test** — which clips, which provider, which claimed
   watermark.
2. **The attack battery** — every attack applied, with ffmpeg invocation
   captured verbatim for re-execution.
3. **The detection matrix** — for each (input × attack × detector) cell,
   whether the watermark survived and with what confidence.
4. **Per-detector letter grades** (A–F) — against thresholds defined in
   [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md).
5. **Environment fingerprint** — ffmpeg version, OS, Node version, auditor
   version, methodology version. Enough to reproduce offline.

Reports are written as JSON today; COSE_Sign1 signing and RFC 3161 qualified
timestamps are on the v0.1 roadmap.

---

## Quickstart (scaffold phase)

```bash
npm install
npm run build
npm run test
npm run audit -- help
npm run audit -- list-attacks
npm run audit -- list-detectors
```

To run the attack battery against the bundled corpus:

```bash
npm run audit -- run --corpus=corpus/corpus.json --verify-hashes
```

This writes `reports/run-<timestamp>.json` with the full attack × detector
matrix, per-cell survival, and per-detector letter grades. On the bundled
corpus the canonical output is
[`reports/sample-run.json`](reports/sample-run.json) — 24 inputs × 5 attacks
× 3 detectors = 360 cells, 110 of which are both baseline-detected and
successfully attacked (91 for `detector.c2pa`, 19 for `detector.xmp-dst`).
22 cells survive: 19 under `container.strip.xmp` (C2PA manifest passes
through structurally) and 3 under `container.strip.c2pa` (XMP DST passes
through entirely).

For ad-hoc inputs:

```bash
npm run audit -- run ./some-clip.mp4 ./another.mp4
```

Positional inputs and `--corpus=` can be combined.

---

## Requirements

- Node.js ≥ 20
- `ffmpeg` on `PATH` (override with `--ffmpeg-path=...`)
- Windows, macOS, or Linux

---

## Architecture at a glance

```
corpus/         local sample media (not committed)
src/
  attacks/      pluggable Attack implementations (ffmpeg pipelines)
  detectors/    pluggable Detector implementations (C2PA, Digimarc, ...)
  runner/       matrix orchestrator (attacks × detectors × inputs)
  reporting/    scoring and JSON report writer
bin/            CLI entry
docs/           methodology, attack catalog, detector catalog, regulatory
reports/        generated reports (not committed)
```

Interfaces live in `src/types.ts`, `src/attacks/types.ts`, and
`src/detectors/types.ts`. Nothing interesting depends on the CLI.

---

## Roadmap

### v0.1 — real detectors and the launch attack battery

- Platform-sim attacks for YouTube, TikTok, Instagram Reels
- ABR ladder attack across a typical 240p–4K rung set
- Screen-capture round-trip attack
- Geometric, temporal, color, and filter attack families
- ✓ C2PA detector backed by
  [`c2pa-manifest-validator`](https://github.com/contentauth) / `c2patool`
- ✓ IPTC XMP `DigitalSourceType` detector (byte-level scan)
- Digimarc / Hive commercial detectors via SDK/API wrappers

### v0.2 — signed, reproducible, publishable reports

- COSE_Sign1 signing of the report envelope (reuses the signing stack from
  `c2pa-manifest-validator`)
- RFC 3161 qualified timestamp token from a qualified trust service provider
- Optional public append-only Merkle log of published reports
  (Certificate-Transparency-shaped)

### v0.3 — the content engine

- Quarterly *State of AI Watermark Robustness* report published from this
  repository's data
- Public results site with per-vendor scorecards

---

## How this project relates to sibling projects

- **`c2pa-manifest-validator`** — used as the C2PA *detector* backend.
  That project answers "does this file have a valid signed C2PA manifest?".
  This project answers "does the watermark still decode after I put it
  through a YouTube re-upload?". Different questions, shared plumbing.
- **`c2pa-validator-web`** — the human-facing compliance auditor UI. This
  project is the adversarial robustness side of the same Art. 50 problem.

---

## License

Apache-2.0. See [LICENSE](LICENSE).
