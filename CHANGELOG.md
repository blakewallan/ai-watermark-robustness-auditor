# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial project scaffold.
- Attack registry interface (`Attack` + `AttackResult`).
- Detector registry interface (`Detector` + `DetectionResult`).
- Matrix runner that composes attacks × detectors over a corpus.
- Reference attack: constant-CRF H.264 re-encode.
- Reference detector: null/echo detector for wiring smoke tests.
- `detector.c2pa` — wraps the `c2pa-manifest-validator` CLI via subprocess
  (configurable through `C2PA_VALIDATE_BIN` or `createC2paDetector({ validatorCommand })`).
  Classification logic (`classifyValidationReport`) extracted as a pure function
  with dedicated unit tests. Maps `claim.missing` → not-detected,
  errors-but-manifest-present → detected @ 0.5 confidence,
  clean report → detected @ 1.0 confidence.
- `platform-sim.youtube.1080p` — YouTube 1080p30 UGC signature
  (libvpx-vp9 ~4 Mbps VBR, libopus 128 kbps, WebM, max 1080p30). Anchored
  at METHODOLOGY.md §A2.
- `abr-ladder.hls-default` — HLS default-ladder 720p round-trip. Two-phase
  pipeline: transcode to H.264 2.8 Mbps + AAC 96 kbps as 6 s fMP4 HLS
  segments, then concat-demux back to a single MP4. Reproduces the VOD
  origin round-trip (Mux / Cloudflare Stream / MediaConvert). Anchored at
  METHODOLOGY.md §A3.
- `container.strip.c2pa` — adversarial byte-level attack. Rewrites every
  ISOBMFF uuid box carrying the registered C2PA UUID
  (`D8FEC3D6-1B0E-483C-9297-5828877EC481`) to a `free` box of identical
  total size, zeroing the UUID and payload. `size`/`largesize` preserved
  so `stco`/`co64` offsets stay correct and playback is bit-exact. Pure
  function `stripC2paUuidBoxes` covered by 7 unit tests. Anchored at
  METHODOLOGY.md §A4.
- `AttackError` + `tailLines` extracted to `src/attacks/shared.ts` to
  avoid copy-paste across attack modules. `AttackError` re-exported from
  `src/attacks/reencode.ts` for backwards compatibility.
- `src/corpus/loader.ts` — validated loader for a `corpus.json` manifest
  (schema version 1). `loadCorpus(jsonPath, { verifyHashes })` resolves
  per-item paths relative to the manifest, optionally recomputes sha256,
  and rejects duplicate ids / unknown watermark kinds / malformed hashes.
  Exposed `sha256File` helper and `CorpusLoadError` as part of the public API.
- Bundled corpus at `corpus/corpus.json` — 7 C2PA-signed test assets
  redistributed from `contentauth/c2pa-js` under MIT (5 JPEGs, `dashinit.mp4`,
  `dash1.m4s`). Attribution and per-file SHA-256s in
  `corpus/adobe-c2pa-js/NOTICE.md`.
- Corpus headline video: `c2pa-org-public/truepic-20230212-zoetrope.mp4`
  (15 MB, Truepic-signed, C2PA 1.4) redistributed from
  `c2pa-org/public-testfiles` under CC BY-SA 4.0. This is the only
  decodable signed MP4 in either upstream source and exercises every
  attack in the battery (reencode, platform-sim, ABR ladder, container
  strip) end-to-end. Attribution in `corpus/c2pa-org-public/NOTICE.md`.
- `tools/sign-corpus.mjs` — operator script that signs raw media with a
  test C2PA manifest so additional clips (self-recorded video, screen
  grabs, etc.) can be added to the corpus with known ground truth. Uses
  `@contentauth/c2pa-node`'s `LocalSigner` with public test credentials
  fetched on demand from `contentauth/c2patool/sample/` and pinned by
  SHA-256 (any upstream rotation hard-aborts the fetch). Supports
  user-supplied credentials via `--key`/`--cert` and optional post-sign
  round-trip verification via the validator. Emits `corpus-fragment.json`
  + `NOTICE.md` into the output directory for merging into `corpus.json`.
  Wired as `npm run sign-corpus`. Docs in `tools/README.md`.
- Added `@contentauth/c2pa-node` as a dev-dependency (required by
  `tools/sign-corpus.mjs` only).
- `reports/sample-run.json` — canonical reference run on the bundled
  corpus (20 inputs × 4 attacks × 2 detectors = 160 cells). 56 cells
  where baseline was C2PA-detected AND the attack applied cleanly; 0 of
  them survived any of the four attacks. Per-attack breakdown
  (survived / applicable, avg ms): `container.strip.c2pa` 0/12 @ 2 ms,
  `reencode.h264.crf23` 0/16 @ 233 ms, `abr-ladder.hls-default` 0/12 @ 260
  ms, `platform-sim.youtube.1080p` 0/16 @ 1,125 ms. Full matrix runs in
  ~37 s on a consumer laptop. Reference Grade F for `detector.c2pa` at
  v0.0 scaffold. Committed so readers can see the JSON shape without
  running the matrix themselves.
- `corpus/synth/` subtree — 12 ffmpeg-synthetic clips spanning the
  parameter grid (240p/480p/720p/1080p × H.264/H.265 × 24/30/60 fps ×
  landscape/square/portrait × video/audio-only/PNG/WebP), each signed
  with the public test credentials via `tools/sign-corpus.mjs`.
  Procedurally-generated from `lavfi` sources (`testsrc2`, `smptebars`,
  `mandelbrot`, `rgbtestsrc`, `cellauto`, `sine`) so the bitstream is
  reproducible across ffmpeg builds without any redistribution-licensed
  third-party media. Digital-source type on the manifest is the IPTC
  `algorithmicallyGenerated` term for faithful provenance. See
  `corpus/synth/NOTICE.md` and `corpus/README.md` §Regenerating the
  synth subtree.
- `detector.xmp-dst` — IPTC XMP `DigitalSourceType` detector. Pure
  byte-level scanner (`scanBytesForXmpDst`) searches the file for the XMP
  `<?xpacket begin=` envelope, then extracts the
  `(Iptc4xmpExt|iptcExt):DigitalSourceType` attribute or element value,
  both bounded to a 64 KB window after the envelope so the scan is cheap
  on multi-megabyte containers. Classifies the URI into `ai-generated`,
  `ai-modified`, `ai-training-data`, `human`, or `unknown` informationally
  — detection itself is binary (URI present → detected @ 1.0; otherwise
  not detected @ 0) because XMP has no signature envelope to grade
  integrity against. Zero runtime dependency on `c2pa-manifest-validator`
  (the detector contract is "one file path in, `DetectionResult` out");
  duplicate taxonomy tables kept narrow and documented. Pure
  `classifyXmpScan` covered by 14 unit tests alongside fixture-driven
  byte-scan tests for attribute/element forms, short `iptcExt:` prefix,
  C2PA `trainedAlgorithmicData`, composite URIs, and no-XMP / no-DST
  negative cases. Registered as the second default detector in
  `defaultDetectors`. `docs/DETECTORS.md` updated.
- `corpus/synth-xmp/` subtree — 4 ffmpeg-synthetic clips (3 MP4s + 1
  JPEG) each carrying **both** a C2PA manifest and an
  `Iptc4xmpExt:DigitalSourceType` XMP packet, injected pre-signing via
  `exiftool -XMP-iptcExt:DigitalSourceType=…` so the disclosure URI is
  part of the bitstream the C2PA hash-binding covers. DST URIs span
  `trainedAlgorithmicMedia`, `compositeWithTrainedAlgorithmicMedia`,
  `algorithmicMedia`, and `digitalCapture` so the detector classifier
  exercises all four non-unknown buckets. See `corpus/synth-xmp/NOTICE.md`
  and `corpus/README.md` §Regenerating the synth-xmp subtree.
- `container.strip.xmp` — adversarial byte-level attack, symmetric
  counterpart to `container.strip.c2pa`. Removes every embedded XMP
  packet while leaving every other byte — including a present C2PA
  `uuid` box — untouched. Dispatches on sniffed container format:
  JPEG (splices out APP1 segments with the XMP or Extended XMP
  namespace), ISOBMFF (rewrites `uuid` boxes with UUID
  `BE7ACFCB-97A9-42E8-9C71-999491E3AFAC` to `free`, size-preserving),
  PNG (splices out `iTXt` chunks keyed `XML:com.adobe.xmp`). Other
  formats surface as `AttackError` so inapplicable cells are excluded
  from the denominator rather than silently logged as no-ops. Pure
  function `stripXmpPackets` covered by 15 unit tests across all three
  formats plus format-sniffing, scan-data safety, truncated inputs, and
  the concurrent-C2PA-preservation guarantee. Anchored at
  METHODOLOGY.md §A5.
- `reports/sample-run.json` canonical run refreshed to cover the full
  360-cell matrix (24 inputs × 5 attacks × 3 detectors). Headline
  signal — **orthogonal failure modes** on the 4-item `synth-xmp/`
  subtree that carries both disclosures:

  |                        | detector.c2pa         | detector.xmp-dst       |
  |------------------------|:---------------------:|:----------------------:|
  | `container.strip.c2pa` | 0 / 3 survived        | **3 / 3** survived     |
  | `container.strip.xmp`  | **3 / 3** survived ¹  | 0 / 4 survived         |

  ¹ C2PA "survives" at confidence 0.5 — manifest box is structurally
  intact but the data-hash assertion no longer matches the bytes, so a
  validator sees "present but has errors" (METHODOLOGY §A5). Meets the
  0.5 survival threshold by design. Whole-corpus scores: detector.c2pa
  19/91 (Grade F, 20.9 %), detector.xmp-dst 3/19 (Grade F, 15.8 %).
  Re-encode style attacks still destroy both signals uniformly: 0/4
  each for `reencode.h264.crf23`, `platform-sim.youtube.1080p`,
  `abr-ladder.hls-default` on `detector.xmp-dst`; 0/20 each on
  `detector.c2pa`. The two disclosure mechanisms have disjoint failure
  surfaces — each surgical attack destroys its own target and leaves
  the other signal intact.

### Changed

- `scoreReport` now excludes cells with `attackErrorMessage` from the
  survival denominator, not just cells with `baselineDetected=false`. An
  attack that failed to apply does not tell us anything about the
  watermark's robustness — counting it as "did not survive" would report
  the attack module's bug as watermark fragility. Added
  `excludedNoBaseline` + `excludedAttackError` to `DetectorScore` so the
  filter is visible on the report envelope. Unit tests updated; existing
  smoke test extended.
- `abr-ladder.hls-default` refactored from a two-phase
  transcode-to-HLS-fmp4 / concat-demuxer round-trip to a single-pass
  transcode at the Apple HLS Authoring Spec 720p-rung parameters. The
  previous two-phase pipeline broke on ffmpeg 8.x because the HLS muxer
  no longer writes the `init.mp4` init segment referenced by its own
  `#EXT-X-MAP` directive. The single-pass variant produces bit-identical
  output to what a downstream re-host would reassemble from the playback
  segments, works across ffmpeg 4.x–8.x, and preserves the C2PA-breaking
  container rewrite that is the attack's substantive claim. METHODOLOGY.md
  §A3 updated with the rationale.
- CLI: `watermark-audit run` now accepts `--corpus=<path>` and
  `--verify-hashes`; positional inputs still work and are appended to
  whatever the manifest loaded, so `run --corpus=default.json extra.mp4`
  is valid. Usage text updated.
- `watermark-audit run` — end-to-end matrix runner over `attacks × detectors × corpus`.
  Emits `reports/<runId>.json` with per-cell survival, per-detector
  survival rate, and an A–F letter grade against the thresholds
  documented in METHODOLOGY.md §Scoring.
- Methodology doc mapping attack battery to EU AI Act Art. 50(2) language.
- Attack catalog and detector catalog docs.

### Planned (v0.1)

- Platform-sim attacks (remaining): TikTok 720p, Instagram Reels 1080p,
  X/Twitter 720p re-upload signatures.
- ABR ladder full variant: `abr-ladder.hls-full` runs every rung (2160p →
  240p) and reports per-rung survival.
- Screen-capture round-trip attack (display-capture-reencode simulation).
- Geometric attacks: crop, rotate, letterbox, mirror.
- Temporal attacks: fps conversion (24/30/60), frame drop, speed.
- Color attacks: saturation, brightness, gamma, colorspace.
- Filter attacks: denoise, sharpen, blur, LUT.
- Compression-starvation attack: bitrate ladder down to 200 kbps.
- Container remux attacks (`mp4-to-webm`, `mp4-to-mov`).
- Report signing: COSE_Sign1 + RFC 3161 qualified timestamp token.
- Public append-only Merkle log of published robustness reports.
