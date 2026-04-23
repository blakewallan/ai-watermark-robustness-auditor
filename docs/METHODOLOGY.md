# Methodology

Version: **0.0-scaffold**

This document defines how we decide whether a watermark survived. The
version string above is stamped into every report envelope. Any change to
thresholds, attack definitions, or scoring rules must bump the version.

---

## Goals

1. **Reproducibility.** A third party with the same corpus and the same
   methodology version must produce byte-identical matrices.
2. **Regulatory legibility.** Scores must map cleanly onto the Art. 50(2)
   words: *effective*, *interoperable*, *robust*, *reliable*.
3. **Adversarial honesty.** We publish every attack invocation. Vendors can
   reproduce any finding; auditors can challenge any finding.
4. **Humility.** A score on our battery is not a statement that a watermark
   is globally robust. It is a statement about survival on *this* battery at
   *this* methodology version.

---

## Attack families

Detailed in [`ATTACKS.md`](ATTACKS.md). Categories:

| Category                  | Why it matters                                                |
| ------------------------- | ------------------------------------------------------------- |
| `reencode`                | Every platform re-encodes on upload. Floor survival.          |
| `platform-sim`            | Reproduces YouTube / TikTok / Instagram signature pipelines.  |
| `abr-ladder`              | HLS/DASH rung-down to 360p–240p.                              |
| `screen-capture`          | Pixel-domain round-trip. Kills most fragile invisible marks.  |
| `geometric`               | Crop, rotate, mirror, letterbox.                              |
| `temporal`                | fps conversion, frame drop, speed change.                     |
| `color`                   | Saturation, gamma, colorspace.                                |
| `filter`                  | Denoise, sharpen, blur, LUT.                                  |
| `compression-starvation`  | Sub-500 kbps floors.                                          |
| `container`               | Remux to MOV/WebM/MKV, strip metadata.                        |

Each attack has an `id`, a `category`, and a `methodologyRef` pointing back
to the anchor in this document where its parameters are specified.

### A1 — H.264 CRF 23 re-encode (`reencode.h264.crf23`)

The baseline floor attack. Single-pass libx264 re-encode, `veryfast` preset,
CRF 23, AAC 128 kbps audio, `+faststart` mux. Chosen because it is
computationally trivial and represents the gentlest transformation a clip
can undergo on a consumer upload. A watermark that does not survive A1 has
no claim to be robust under any later attack.

### A2 — YouTube 1080p30 UGC signature (`platform-sim.youtube.1080p`)

Reproduces the resolution / codec / bitrate / container signature of
YouTube's current 1080p30 UGC download path: scale height to ≤ 1080 with
width rounded to an even number, cap framerate at 30, libvpx-vp9 at
~4 Mbps VBR (min 2 / max 5) with a 2-second GOP, libopus audio at
128 kbps, WebM container. Not YouTube's *actual* pipeline — we do not have
that source — but close enough to the public telemetry that a watermark
surviving A2 is very likely to survive a real YouTube re-upload. WebM
output is deliberate: a detector that cannot read WebM cannot support the
largest video platform on earth, and that is a finding worth surfacing.

### A3 — HLS default-ladder 720p round-trip (`abr-ladder.hls-default`)

Single-pass transcode to the 720p rung of Apple's HLS Authoring
Specification default ladder (ARKit HLS §4.1, 2024-02): H.264 High profile
at Level 3.1, ~2.8 Mbps CBR-ish (`maxrate = bufsize / 2`), 2-second closed
GOPs (`-g 48 -keyint_min 48 -sc_threshold 0`), AAC-LC 96 kbps stereo
48 kHz audio, `-movflags +faststart` MP4 mux.

Why a single pass rather than a two-phase "segment then concat" round-trip:
a downstream re-host ends up with the same flat MP4 bitstream that the
player would reassemble from the ladder's playback segments — the HLS
packaging layer is transparent to the bytes. Keeping the attack as one
ffmpeg invocation makes it reproducible across ffmpeg 4.x–8.x despite
breakages in the HLS muxer's fMP4 init-segment handling.

C2PA hard-binding assertions do not survive this attack under any encoder
— the asset hash is computed over the concatenation of top-level ISOBMFF
boxes and libx264's re-encode + `+faststart` remux rewrite the `moov`/`mdat`
pair wholesale. Pixel-domain watermarks with adequate bit budget generally
survive; marks with poor rate-distortion behaviour do not.

### A4 — Strip C2PA uuid boxes (`container.strip.c2pa`)

Adversarial, byte-level, no-re-encode attack. Walks the input as ISOBMFF
top-level boxes; for every `uuid` box whose UUID equals the registered
C2PA UUID (`D8FEC3D6-1B0E-483C-9297-5828877EC481`, ISO/IEC 14496-12 §8.4
+ C2PA 2.0 §9) rewrites the type field to `"free"` and zeroes the UUID
and payload. Box `size` and `largesize` fields are preserved exactly, so
every subsequent byte offset in the file — including `stco`/`co64`
sample-table entries inside `moov` — still resolves correctly and
playback is bit-exact on video and audio tracks.

A4 exists to measure the gap between the claims "C2PA is tamper-evident"
and "C2PA is durable". The first is a correct claim about a *present*
manifest; the second is not a claim anyone should make. Any vendor
robustness argument that relies on the manifest remaining in the file has
to answer for A4, because anyone with a hex editor can reproduce it.

### A5 — Strip XMP packets (`container.strip.xmp`)

Adversarial, byte-level, no-re-encode attack. The symmetric counterpart
to A4 for the IPTC/XMP disclosure channel. Dispatches on container
format and removes every embedded XMP packet:

- **JPEG (ITU-T T.81):** walks segment markers from SOI forward; splices
  out every APP1 segment (`FFE1`) whose body begins with the XMP
  namespace `http://ns.adobe.com/xap/1.0/\0` or the Extended XMP
  namespace `http://ns.adobe.com/xmp/extension/\0`. JPEG has no
  absolute-offset references, so splicing produces a strictly smaller
  but fully decodable file.
- **ISOBMFF (ISO/IEC 14496-12):** walks top-level boxes; rewrites every
  `uuid` box whose UUID equals the registered XMP UUID
  (`BE7ACFCB-97A9-42E8-9C71-999491E3AFAC`, XMP Spec Part 3 §1.1.3) to a
  `free` box of identical total size, zeroing UUID and payload. Byte
  offsets are preserved so `stco`/`co64` sample-table references stay
  valid — identical strategy to A4.
- **PNG (ISO/IEC 15948):** walks chunks after the 8-byte signature;
  splices out every `iTXt` chunk whose keyword equals
  `XML:com.adobe.xmp` (XMP Spec Part 3 §1.1.4). Each chunk is
  self-contained with its own CRC, so splicing is safe.

All other container formats (WebP, OGG, TIFF, …) surface as
`AttackError` so the runner records them as inapplicable rather than
silently pretending the attack succeeded — scored cells that cannot be
attacked are excluded from the denominator per the Scoring section
below.

**Interaction with C2PA hard-binding.** When a C2PA manifest was signed
after XMP injection — the case for the bundled `corpus/synth-xmp/`
items — the data-hash assertion covers bytes that include the XMP
packet, so A5 invalidates the hard-binding hash. The manifest *box*
itself is untouched, however, so `detector.c2pa` continues to report
`detected=true` with confidence `0.5` ("manifest present but has
errors"). By the Detection threshold below (survival at confidence
`>= 0.5`) the C2PA cell *survives* A5. That is the publishable signal:
A5 does not remove the C2PA claim, it invalidates the binding — and
validator policy decides whether to trust the resulting "present but
broken" manifest.

A5 exists for the same reason A4 does, in mirror image. Many upload
pipelines (TikTok, WhatsApp, Twitter/X preview generation) aggressively
strip XMP from images and videos on ingest, and the resulting byte
shape is indistinguishable from what A5 produces. A disclosure scheme
that relies on XMP for its machine-readable signal has to survive this
transformation or accept that the signal is absent on those platforms.

Together A4 and A5 form a two-cell orthogonality check: when both
disclosure mechanisms are present on the same asset, A4 should destroy
C2PA while preserving XMP, and A5 should destroy XMP while preserving
C2PA (modulo the hard-binding note above). The v0.0 sample run on the
bundled 4-item `synth-xmp/` subtree exhibits exactly this behaviour on
all four items — see [CHANGELOG.md](../CHANGELOG.md) for the numbers.

---

## Detection

Each detector answers `(detected: boolean, confidence: 0..1)` for a media
file. See [`DETECTORS.md`](DETECTORS.md) for the interface and the launch set.

A cell is a *survivor* if:

```
postAttackDetected == true  AND  postAttackConfidence >= 0.5
```

The 0.5 threshold exists so low-confidence false positives from flaky
detectors do not inflate survival rates.

---

## Scoring

For a given detector, **survival rate** is:

```
survived / cellsConsidered
```

where `cellsConsidered` excludes any cell whose

1. **baseline (pre-attack) detection was `false`** — if the detector could
   not find the watermark before the attack, the attack cannot be blamed
   for it being absent after; and
2. **attack failed to apply at all** (non-empty `attackErrorMessage`) — an
   attack that aborted on a malformed input (e.g. `container.strip.c2pa`
   rejecting a JPEG because it is not ISOBMFF) does not measure anything
   about watermark robustness, so counting it as "did not survive" would
   conflate attack-module applicability with watermark fragility.

Both exclusions are recorded on the `DetectorScore` envelope
(`excludedNoBaseline`, `excludedAttackError`) so the denominator is
auditable without reconstructing the raw matrix.

### Grade thresholds (v0.0)

| Survival rate   | Grade | Interpretation                                   |
| --------------- | ----- | ------------------------------------------------ |
| ≥ 95%           | A     | Robust across the battery                        |
| ≥ 85%           | B     | Mostly robust; one or two attack families fail   |
| ≥ 70%           | C     | Inconsistent; a notable fraction of attacks win  |
| ≥ 50%           | D     | Weak; coin-flip territory                        |
| < 50%           | F     | Not robust in any useful regulatory sense        |

These thresholds are deliberately conservative on the A end. Anything below
95% survival on a *floor* attack battery is not meaningfully defensible as
"robust" under Art. 50(2).

---

## Reproducibility envelope

Every report records:

- `methodologyVersion` — this document's version string.
- `auditorVersion` — the npm package version that produced it.
- `ffmpegVersion` — output of `ffmpeg -version` first line.
- `os`, `nodeVersion`.
- `startedAt`, `finishedAt` (UTC ISO-8601).

To re-verify a report: pin to `auditorVersion`, install the matching
`ffmpegVersion`, supply the same corpus hashes, rerun. The matrix must
match modulo nondeterminism called out in each attack doc.

---

## What this methodology explicitly does not claim

- It does not test *perceptibility* of the watermark. That's a different
  (and important) test we may ship separately.
- It does not test *false positive rate* of detectors on unwatermarked
  content. That's also separate.
- It does not score a vendor's full compliance with Art. 50. It scores
  robustness, which is one of four adjectives in the statute.
