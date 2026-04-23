# Detector Catalog

A detector takes a media file on disk and answers: **did the watermark
survive?** Each detector is responsible for exactly one `WatermarkKind`
and wraps whatever SDK, CLI, or network call the vendor exposes.

Interface lives in [`src/detectors/types.ts`](../src/detectors/types.ts).

---

## Shipped (v0.0)

### `detector.null`

- **Watermark kind:** `unknown`
- **Purpose:** Wiring smoke-test and negative control. Always returns
  `detected = false` with confidence 0.
- **Ship status:** present by design; should never be the only detector
  used for a scored report.

### `detector.c2pa`

- **Watermark kind:** `c2pa`
- **Mechanism:** Shells out to the `c2pa-manifest-validator` CLI with
  `<file> --json`. The validator internally selects the best available
  backend (`@contentauth/c2pa-node` → `c2patool` → native parser) and
  emits a `ValidationReport`. A file is "detected" when a C2PA claim is
  parseable.
- **Confidence:**
  - `1.0` — clean report, zero error-severity issues.
  - `0.5` — manifest parses but has error-severity issues (signature
    invalid, hard-binding hash mismatch, trust-list rejection, etc.).
  - `0` — `manifest/manifest-present` error or `claim.missing` status
    code on any rule.
- **Configuration:** the validator command defaults to `c2pa-validate`
  on `PATH`. Override via the `C2PA_VALIDATE_BIN` env var or the
  `validatorCommand` option on `createC2paDetector(...)`. Supports
  multi-word commands, e.g.
  `node ../c2pa-manifest-validator/dist/bin/c2pa-validate.js`.
- **Exit codes handled:**
  - `0` / `1` — JSON on stdout is parsed and classified.
  - `2` — usage / unrecoverable I/O error from the validator is surfaced
    verbatim in `DetectionResult.errorMessage`.
- **Classification logic** is a pure function,
  `classifyValidationReport(report)`, covered by unit tests in
  [`tests/detectors.c2pa.test.ts`](../tests/detectors.c2pa.test.ts).

### `detector.xmp-dst`

- **Watermark kind:** `iptc-xmp`
- **Mechanism:** Pure byte-level scan of the asset for an embedded XMP
  packet (`<?xpacket begin=` envelope PI) and, within it, the IPTC
  `DigitalSourceType` field (either attribute form
  `Iptc4xmpExt:DigitalSourceType="…"` or element form). Works across
  every container format that embeds the XMP envelope verbatim — JPEG
  APP1, PNG `iTXt`, ISOBMFF `uuid` boxes, PDF metadata streams, sidecar
  XMP files — because the envelope is a byte-literal sentinel rather
  than a format-specific marker. Scan is bounded to a 64 KB window
  starting at the envelope, so cost is O(file) for `indexOf` and O(1)
  for the regex match regardless of container size.
- **Why not reuse `scanXmp` from `c2pa-manifest-validator`:** the
  detector contract is "one file path in, `DetectionResult` out," and
  the robustness auditor does not need the validator's richer
  classification surface (warnings on truncated packets,
  `creators` / `CreatorTool` extraction, disclosure-strength lifting).
  We intentionally duplicate the ~50-line byte scan rather than take a
  runtime dependency on the whole validator library. The IPTC /C2PA URI
  taxonomies are pinned here in a narrow table that covers the set used
  in the detector's informational `classification` field only.
- **Confidence:**
  - `1.0` — an `Iptc4xmpExt:DigitalSourceType` (or short-form
    `iptcExt:DigitalSourceType`) URI is present. Unsigned by
    construction, so any visible URI counts as a surviving disclosure —
    a rule engine on top of the auditor can gate on semantic category if
    needed.
  - `0` — no XMP envelope, or envelope present but no DST field.
- **Evidence recorded:** `reason` (`xmp-absent` /
  `xmp-present-no-dst` / `dst-present`), the DST URI string,
  `classification` bucket (`ai-generated`, `ai-modified`,
  `ai-training-data`, `human`, `unknown`), and the byte offset where
  the XMP envelope started. All embedded verbatim in the signed report.
- **Classification logic** is a pure function, `classifyXmpScan(scan)`,
  alongside the pure byte scanner `scanBytesForXmpDst(bytes)`. Both
  covered by [`tests/detectors.xmp-dst.test.ts`](../tests/detectors.xmp-dst.test.ts).
- **Corpus interaction:** the bundled
  [`corpus/synth-xmp/`](../corpus/synth-xmp/) subtree injects four DST
  URIs (`trainedAlgorithmicMedia`, `compositeWithTrainedAlgorithmicMedia`,
  `algorithmicMedia`, `digitalCapture`) into synthetic clips before
  C2PA-signing so both detectors produce baseline signal on the same
  bitstream. See [`reports/sample-run.json`](../reports/sample-run.json)
  for the headline interaction: `container.strip.c2pa` destroys C2PA in
  every cell but preserves XMP DST in every MP4 cell (3/3).

---

## Launch set (planned-v0.1)

### `detector.digimarc`

- **Watermark kind:** `digimarc`
- **Mechanism:** Digimarc SDK. Requires commercial license — wrap only;
  do not redistribute. Exposes `confidence` natively.
- **License handling:** detector must refuse to run if no license is
  configured, rather than failing silently.

### `detector.hive`

- **Watermark kind:** `hive`
- **Mechanism:** HTTPS call to Hive's AI-generated-content detection API.
  Rate-limited; cache by `sha256(bytes)`.

### `detector.synthid` *(aspirational)*

- **Watermark kind:** `synthid`
- **Mechanism:** public detector if/when Google publishes one. If no public
  detector exists at the time of a report, the report must call this out
  explicitly rather than silently dropping SynthID from the matrix.

### `detector.truepic`

- **Watermark kind:** `truepic`
- **Mechanism:** Truepic Lens verify SDK.

---

## How to add a new detector

1. Implement `Detector` in `src/detectors/<id>.ts`. Keep the file single-
   purpose; no cross-detector helpers.
2. Add to `defaultDetectors` in `src/detectors/registry.ts` in alphabetical
   order by `id`.
3. Export from `src/index.ts`.
4. Add an entry to this document with: mechanism, license posture,
   confidence semantics, failure modes.
5. Add fixtures under `tests/fixtures/<detector-id>/` — at minimum one
   positive and one negative sample — and a unit test that pins the
   expected `DetectionResult` shape.
6. If the detector calls a network API, document rate limits and caching.

---

## Failure modes we explicitly support

- **Detector unavailable** (SDK not installed, API key missing): the
  detector's `detect` method throws; the runner records the cell as
  `postAttackDetected = false` with `detectErrorMessage` populated.
  The scoring logic still treats it as a survival failure, which is the
  *correct* outcome — if the buyer of the report cannot verify the
  watermark with the documented detector, the watermark did not meet
  the "reliable" prong of Art. 50(2) for that report.

- **Confidence NaN or out of range**: treat as 0.

- **Flaky detector**: detectors may retry internally but should surface
  final failure rather than silently produce a low-confidence number.
