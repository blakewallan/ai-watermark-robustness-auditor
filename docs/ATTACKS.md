# Attack Catalog

Each attack is a pure transformation from a `CorpusItem` to a new media
file on disk. Attacks live under `src/attacks/` and are registered in
`src/attacks/registry.ts`. New attacks ship together with a methodology
anchor in `METHODOLOGY.md`.

Legend:

- **Status:** `shipped` | `planned-v0.1` | `planned-v0.2` | `research`
- **Category:** matches `AttackCategory` in `src/types.ts`
- **Stability:** `deterministic` if two runs produce byte-identical output
  given the same ffmpeg version, otherwise `nondeterministic` with a note.

---

## reencode

### `reencode.h264.crf23`

- **Status:** `shipped`
- **Category:** `reencode`
- **Stability:** deterministic
- **Methodology:** [`METHODOLOGY.md#A1`](METHODOLOGY.md#a1--h264-crf-23-re-encode-reencodeh264crf23)

Single-pass libx264 CRF-23, `veryfast` preset, AAC 128 kbps, `+faststart`.
Floor attack.

### `reencode.h265.crf28` *(planned-v0.1)*

Typical 4K UGC upload path on newer platforms. Tests HEVC robustness.

### `reencode.av1.crf30` *(planned-v0.1)*

AV1 is the path YouTube is progressively moving UGC to. Separate category
entry because the entropy coder is structurally different and some
invisible marks survive x264 but not AV1.

### `reencode.vp9.crf32` *(planned-v0.1)*

Matches the current YouTube 1080p UGC path.

---

## platform-sim

Reproduces the *characteristic* encoding signature of a consumer platform
upload — resolution ceiling, fps cap, bitrate curve, container re-mux. Not
the platform's *actual* pipeline (we cannot see inside it), but close
enough that a robustness claim should survive it or be retracted.

### `platform-sim.youtube.1080p`

- **Status:** `shipped`
- **Category:** `platform-sim`
- **Stability:** deterministic modulo libvpx-vp9 version
- **Methodology:** [`METHODOLOGY.md#A2`](METHODOLOGY.md#a2--youtube-1080p30-ugc-signature-platform-simyoutube1080p)

Scale to max 1080p with even width, cap at 30 fps, libvpx-vp9 ~4 Mbps VBR
(min 2 / max 5) with `-g 60`, `-deadline good -cpu-used 4 -row-mt 1`,
libopus 128 kbps audio, WebM container. Matches the current YouTube
1080p30 UGC-download signature.

### `platform-sim.tiktok.720p` *(planned-v0.1)*

2.5 Mbps H.264, 30 fps cap, 9:16 crop.

### `platform-sim.reels.1080p` *(planned-v0.1)*

Instagram/Meta signature.

### `platform-sim.x.720p` *(planned-v0.1)*

X/Twitter upload pipeline.

---

## abr-ladder

Transcode through a representative HLS/DASH origin round-trip. Our default
entry is `hls-default`, which exercises a single rung + segmentation rather
than the full ladder; the "survive every rung" variant is a v0.2 follow-up.

### `abr-ladder.hls-default`

- **Status:** `shipped`
- **Category:** `abr-ladder`
- **Stability:** deterministic modulo libx264 version
- **Methodology:** [`METHODOLOGY.md#A3`](METHODOLOGY.md#a3--hls-default-ladder-720p-round-trip-abr-ladderhls-default)

Two-phase: (1) transcode to 720p H.264 @ 2.8 Mbps with 6 s fMP4 HLS
segments (VOD playlist), AAC 96 kbps audio; (2) concat-demux the init
segment + media segments back into a single progressive MP4. Reproduces
the Mux / Cloudflare Stream / MediaConvert origin path that every C2PA
hard-binding assertion has to survive if a watermark claim is to hold
through HLS distribution.

Default rungs for the full-ladder variant (planned-v0.2), mirroring
Apple's HLS Authoring Spec:

| Resolution | Bitrate |
| ---------- | ------- |
| 2160p      | 18000 k |
| 1080p      | 5000 k  |
| 720p       | 2800 k  |
| 540p       | 1400 k  |
| 360p       | 730 k   |
| 240p       | 365 k   |

### `abr-ladder.hls-full` *(planned-v0.2)*

Run every rung in the table above and report per-rung survival.

---

## screen-capture *(planned-v0.1)*

`screen-capture.simulated.1080p30` — approximates a display→capture→re-encode
round trip by: 4:2:0 downsample → RGB→YUV roundtrip → 30 fps decimation →
re-encode at consumer bitrates. Pixel-domain invisible marks tend to die
here.

A hardware version of this attack is on the research roadmap: HDMI
capture from a monitor, OBS re-encode, re-upload. Too nondeterministic
for the default battery but useful for headline reports.

---

## geometric *(planned-v0.1)*

- `geometric.crop.center.90pct` — center crop retaining 90% of area
- `geometric.crop.bottom-third` — common TikTok caption-bar crop
- `geometric.letterbox.16to9` — 4:3 → letterboxed 16:9
- `geometric.pillarbox.9to16` — landscape → portrait repost
- `geometric.rotate.180` — upside-down upload
- `geometric.mirror.horizontal`

---

## temporal *(planned-v0.1)*

- `temporal.fps.24to30` and `temporal.fps.30to60` — conversion pipelines
- `temporal.drop.every-5th-frame`
- `temporal.speed.95pct` — subtle slow-down, the "beat-the-copyright-filter"
  attack seen in the wild
- `temporal.speed.105pct`

---

## color *(planned-v0.1)*

- `color.gamma.0.9` and `color.gamma.1.1`
- `color.saturation.0.7` and `color.saturation.1.3`
- `color.colorspace.bt709-to-bt2020-and-back`

---

## filter *(planned-v0.1)*

- `filter.denoise.nlmeans`
- `filter.sharpen.unsharp`
- `filter.blur.gaussian.sigma2`
- `filter.lut.instagram-warm`

---

## compression-starvation *(planned-v0.1)*

- `compression-starvation.500k`
- `compression-starvation.250k`

At 250 kbps most invisible marks are gone. The value of measuring this
attack is establishing *where* each watermark breaks, not whether it does.

---

## container

### `container.strip.c2pa`

- **Status:** `shipped`
- **Category:** `container`
- **Stability:** deterministic (byte-level rewrite, no encoder involved)
- **Methodology:** [`METHODOLOGY.md#A4`](METHODOLOGY.md#a4--strip-c2pa-uuid-boxes-containerstripc2pa)

Adversarial, byte-level. Walks ISOBMFF top-level boxes; for every `uuid`
box carrying the registered C2PA UUID (`D8FEC3D6-1B0E-483C-9297-5828877EC481`)
rewrites the type field to `"free"` and zeroes the UUID and payload.
`size` / `largesize` fields are preserved, so no byte offset in the file
shifts and `stco`/`co64` remain correct — playback is bit-exact. Pixel-
level watermarks are unaffected; a C2PA manifest inside the original box
is not recoverable. Pure function (`stripC2paUuidBoxes`) covered by unit
tests against 32-bit headers, 64-bit headers, multiple boxes per file,
non-C2PA uuid boxes, and non-ISOBMFF inputs.

### `container.strip.xmp`

- **Status:** `shipped`
- **Category:** `container`
- **Stability:** deterministic (byte-level rewrite, no encoder involved)
- **Methodology:** [`METHODOLOGY.md#A5`](METHODOLOGY.md#a5--strip-xmp-packets-containerstripxmp)

Adversarial, byte-level, no-re-encode. The symmetric counterpart to
`container.strip.c2pa`: removes every embedded XMP packet while leaving
every other byte — including a present C2PA `uuid` box — untouched.

Per-format behaviour:

- **JPEG:** walks segment markers from SOI forward; splices out every
  APP1 segment carrying either the XMP namespace
  (`http://ns.adobe.com/xap/1.0/\0`) or the Extended XMP namespace
  (`http://ns.adobe.com/xmp/extension/\0`). Output file is strictly
  smaller but fully decodable.
- **ISOBMFF (MP4 / MOV / HEIF):** walks top-level boxes; rewrites
  every `uuid` box carrying the XMP UUID
  (`BE7ACFCB-97A9-42E8-9C71-999491E3AFAC`) to a `free` box of
  identical total size, zeroing UUID and payload. `size` / `largesize`
  preserved — byte offsets unchanged, `stco`/`co64` still valid,
  playback bit-exact (same strategy as `container.strip.c2pa`).
- **PNG:** walks chunks after the signature; splices out every `iTXt`
  chunk keyed `XML:com.adobe.xmp`. Each chunk is self-contained (its
  own CRC), so splicing is safe.

All other container formats (WebP, OGG, TIFF, …) surface as
`AttackError` so the runner marks those cells inapplicable rather than
pretending a no-op succeeded.

Interaction with C2PA hard-binding: when the manifest was signed *after*
XMP injection, the attack invalidates the data-hash assertion but leaves
the manifest box structurally intact. `detector.c2pa` therefore reports
`detected=true` at confidence `0.5` ("manifest present but has errors"),
which meets the v0.0 survival threshold. See METHODOLOGY §A5 for why
this is the publishable signal rather than a bug.

Pure function `stripXmpPackets` is covered by unit tests against JPEG
(single XMP, Extended XMP, benign Exif, scan-data safety, truncated
inputs), ISOBMFF (strip with concurrent C2PA box preservation, non-XMP
uuid boxes, no-XMP passthrough), and PNG (XMP iTXt strip, non-XMP iTXt
preservation, empty PNG).

### `container.remux.mp4-to-webm` *(planned-v0.1)*

### `container.remux.mp4-to-mov` *(planned-v0.1)*

---

## Research-only (not in default battery)

- `research.vae-roundtrip` — encode through a public VAE and decode back;
  approximates another AI system ingesting and re-emitting the frame
- `research.diffusion-inpaint` — very mild inpainting pass
- `research.style-transfer` — a light style transfer pass

These are adversarial and unlikely to be "fair" as a compliance
measurement, but they generate the headline findings that drive interest.
