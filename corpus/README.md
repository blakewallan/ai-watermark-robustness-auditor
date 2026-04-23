# Corpus

Test media for the robustness auditor, described by [`corpus.json`](corpus.json).

> **Media is not committed.** The repo tracks `corpus.json`, each
> subtree's `NOTICE.md`, and the synth `corpus-fragment.json` manifests
> — the actual ~34 MB of binary media is rebuilt locally by
> `npm run setup-corpus` (implemented in
> [`tools/fetch-corpus.mjs`](../tools/fetch-corpus.mjs)). Synthetic
> clips in `synth/` and `synth-xmp/` are deterministically regenerated
> from ffmpeg `lavfi` sources; external samples (`adobe-c2pa-js/`,
> `c2pa-org-public/`) are documented in their NOTICE files and must
> be fetched once from their upstream. See the repo-root README for
> the full bootstrap flow.

## What's committed (metadata only)

- **`corpus.json`** — the manifest. Schema version 1. Paths inside resolve
  relative to this folder. Each item pins id, label, expected watermarks,
  sha256, license, and source URL so reports can be audited end-to-end.
- **`adobe-c2pa-js/NOTICE.md`** — attribution and per-file SHA-256s for
  the seven C2PA-signed test assets (5 JPEGs, 1 MP4 init segment, 1 fMP4
  media segment) redistributed from
  [`contentauth/c2pa-js`](https://github.com/contentauth/c2pa-js) under
  MIT.
- **`c2pa-org-public/NOTICE.md`** — attribution for the real (~15 MB)
  Truepic-signed MP4 from the C2PA Conformance Program's
  [`c2pa-org/public-testfiles`](https://github.com/c2pa-org/public-testfiles)
  corpus, redistributed under CC BY-SA 4.0. This is the headline
  real-world video item and the only decodable signed MP4 available in
  either upstream source.
- **`synth/NOTICE.md`** + **`synth/corpus-fragment.json`** — inventory
  and signing metadata for the twelve ffmpeg-synthetic clips (varied
  resolutions, codecs, aspect ratios, frame rates, plus a still-image
  pair) signed with the same public test credentials. These exist so
  the corpus exercises every attack across a wide parameter grid
  without depending on third-party hosting or redistribution rights.
  See [below](#regenerating-the-synth-subtree) for the exact ffmpeg
  invocations (also encoded in `tools/fetch-corpus.mjs`).
- **`synth-xmp/NOTICE.md`** + **`synth-xmp/corpus-fragment.json`** —
  inventory for four ffmpeg-synthetic clips (3 MP4s + 1 JPEG) that
  carry **both** a C2PA manifest and an `Iptc4xmpExt:DigitalSourceType`
  XMP packet injected *before* signing so the DST URI is part of the
  C2PA-hashed bitstream. Exists specifically to exercise
  `detector.xmp-dst` in the default matrix. See
  [below](#regenerating-the-synth-xmp-subtree) for the invocations.

Any binary media under `corpus/` is `.gitignore`d by extension
(`*.mp4`, `*.m4a`, `*.jpg`, `*.png`, `*.webp`, etc.) — add your own
local samples freely without worrying about accidental commits.

## Regenerating the `synth/` subtree

The synthetic corpus is deliberately reproducible: every entry is the
output of an ffmpeg invocation over bundled `lavfi` synthetic sources
(`testsrc2`, `smptebars`, `mandelbrot`, `rgbtestsrc`, `cellauto`,
`sine`), signed by `tools/sign-corpus.mjs` with public test credentials
pinned by SHA-256.

```powershell
# 1. raw media (PowerShell; one ffmpeg invocation per file)
$raw = "work/raw-synth"
Remove-Item $raw -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $raw -Force | Out-Null
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "testsrc2=size=320x240:rate=24:duration=3" -f lavfi -i "sine=frequency=300:sample_rate=48000:duration=3" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 64k  -shortest "$raw/synth-240p24-testsrc2-3s.mp4"
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "testsrc2=size=854x480:rate=30:duration=5" -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=5" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 96k  -shortest "$raw/synth-480p30-testsrc2-5s.mp4"
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "mandelbrot=size=1280x720:rate=30" -t 5 -f lavfi -i "sine=frequency=500:sample_rate=48000:duration=5" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 96k  -shortest "$raw/synth-720p30-mandelbrot-5s.mp4"
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "smptebars=size=1280x720:rate=60:duration=3" -f lavfi -i "sine=frequency=600:sample_rate=48000:duration=3" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 96k  -shortest "$raw/synth-720p60-smptebars-3s.mp4"
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=5" -f lavfi -i "sine=frequency=700:sample_rate=48000:duration=5" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 128k -shortest "$raw/synth-1080p30-testsrc2-5s.mp4"
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=5" -f lavfi -i "sine=frequency=700:sample_rate=48000:duration=5" -c:v libx265 -preset veryfast -pix_fmt yuv420p -tag:v hvc1 -c:a aac -b:a 128k -shortest "$raw/synth-1080p30-h265-testsrc2-5s.mp4"
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "rgbtestsrc=size=720x1280:rate=30:duration=5" -f lavfi -i "sine=frequency=800:sample_rate=48000:duration=5" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 96k  -shortest "$raw/synth-vertical-720x1280-rgbtestsrc-5s.mp4"
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "cellauto=rule=110:size=720x720:rate=30" -t 5 -f lavfi -i "sine=frequency=900:sample_rate=48000:duration=5" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 96k  -shortest "$raw/synth-square-720-cellauto-5s.mp4"
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=15" -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=15" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 96k -shortest "$raw/synth-long-720p30-testsrc2-15s.mp4"
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=10" -c:a aac -b:a 128k "$raw/synth-audio-only-aac-10s.m4a"
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "testsrc2=size=512x512:rate=1:duration=1" -frames:v 1 "$raw/synth-png-testsrc2-512.png"
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "mandelbrot=size=512x512:rate=1" -frames:v 1 "$raw/synth-webp-mandelbrot-512.webp"

# 2. sign (requires `npm install` + one-time `node tools/sign-corpus.mjs --fetch-test-creds`)
node tools/sign-corpus.mjs `
  --output=corpus/synth `
  --source-tag=synth `
  --license=CC0-1.0 `
  --source-url="local:ffmpeg-synthetic" `
  --digital-source="https://cv.iptc.org/newscodes/digitalsourcetype/algorithmicallyGenerated" `
  --verify `
  work/raw-synth
```

The ffmpeg bitstream for these sources is stable across libx264/libx265
builds for at least the `veryfast` preset, but C2PA-manifest bytes
depend on signing time and credentials, so the SHA-256s in
`synth/NOTICE.md` will differ if you regenerate — that's expected. What
matters for the corpus is the parameter grid, which is deterministic.

## Regenerating the `synth-xmp/` subtree

Requires [`exiftool`](https://exiftool.org/) on `PATH` in addition to
ffmpeg. On Windows:

```powershell
winget install --id=OliverBetz.ExifTool -e
```

The recipe:

```powershell
$raw = "work/raw-xmp"
Remove-Item $raw -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $raw -Force | Out-Null

# 1. raw media (identical bitstream template for the three MP4s so the only
#    difference across items is the DST URI injected below)
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "testsrc2=size=640x360:rate=30:duration=3" -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=3" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 96k -shortest "$raw/synth-xmp-trained-video.mp4"
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "testsrc2=size=640x360:rate=30:duration=3" -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=3" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 96k -shortest "$raw/synth-xmp-capture-video.mp4"
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "mandelbrot=size=640x360:rate=30" -t 3 -f lavfi -i "sine=frequency=500:sample_rate=48000:duration=3" -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 96k -shortest "$raw/synth-xmp-composite-video.mp4"
ffmpeg -y -hide_banner -loglevel error -f lavfi -i "testsrc2=size=512x512:rate=1:duration=1" -frames:v 1 "$raw/synth-xmp-algorithmic.jpg"

# 2. inject Iptc4xmpExt:DigitalSourceType into the raw bitstream so the
#    URI is part of what C2PA hash-binds over in step 3.
exiftool -overwrite_original -XMP-iptcExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"                    "$raw/synth-xmp-trained-video.mp4"
exiftool -overwrite_original -XMP-iptcExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/digitalCapture"                            "$raw/synth-xmp-capture-video.mp4"
exiftool -overwrite_original -XMP-iptcExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia"      "$raw/synth-xmp-composite-video.mp4"
exiftool -overwrite_original -XMP-iptcExt:DigitalSourceType="http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia"                          "$raw/synth-xmp-algorithmic.jpg"

# 3. C2PA-sign (same public test credentials as the `synth/` subtree)
node tools/sign-corpus.mjs `
  --output=corpus/synth-xmp `
  --source-tag=synth-xmp `
  --author="Synthetic (ffmpeg + exiftool) / XMP-injected" `
  --license=CC0-1.0 `
  --digital-source="https://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia" `
  --verify `
  work/raw-xmp
```

After signing, every item has **two** AI-disclosure signals in its
bytes: the signed C2PA manifest (exercises `detector.c2pa`) and the
unsigned IPTC XMP `DigitalSourceType` URI (exercises
`detector.xmp-dst`). This is the bitstream shape the auditor is built
to reason about.

## Running against the bundled corpus

```
npm run build
watermark-audit run --corpus=corpus/corpus.json --verify-hashes
```

`--verify-hashes` recomputes sha256 for each item and aborts on mismatch.
Slightly slower; recommended for published-report runs.

## Adding a new sample

1. Drop the media file under `corpus/<source-tag>/`, e.g.
   `corpus/my-sora-exports/gen-2026-04-18.mp4`.
2. Compute its sha256 (`(Get-FileHash -Algorithm SHA256 <file>).Hash` on
   Windows; `sha256sum` on Linux/macOS).
3. Append an entry to `corpus.json`:

   ```jsonc
   {
     "id": "sora-export-2026-04-18",           // unique
     "label": "Sora UGC export 2026-04-18",
     "path": "my-sora-exports/gen-2026-04-18.mp4",
     "expectedWatermarks": ["c2pa", "synthid"],
     "sha256": "<lowercase hex>",
     "license": "proprietary",                 // free-form string
     "source": "https://openai.com/..."        // optional provenance
   }
   ```

4. Run with `--verify-hashes` once to make sure your hash is correct.

## What belongs in a published corpus

- Signed outputs from AI video generators (Runway, Pika, Kling, Luma,
  Sora, etc.) with embedded C2PA / SynthID / Digimarc marks.
- Known-human-origin control clips from a camera you own, explicitly
  unsigned (baseline detectors must return `detected=false` on these).
- Platform-roundtripped samples — e.g. a Pika clip after a YouTube
  re-upload — if you want a pre-attacked baseline.

## What does not belong

- Any clip you do not have the right to redistribute. Keep those in a
  private folder and reference them from a local-only corpus JSON that
  is not committed.
- Real people you do not have a release for. Synthetic is preferred.

## Naming convention for ad-hoc samples

```
<provider>__<model>__<yyyy-mm-dd>__<short-slug>.<ext>

e.g.
runway__gen3__2026-03-14__talking-head.mp4
pika__1.0__2026-02-09__city-flyover.mp4
camera__sony-a7iv__2026-04-01__control-daylight.mov
```

Consistent names make the generated `reports/*.json` diff-able across
runs.
