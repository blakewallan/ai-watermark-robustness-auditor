# `c2pa-org/public-testfiles` — redistribution notice

The files in this directory are sourced from the
[C2PA Public Test Files](https://spec.c2pa.org/public-testfiles/) repository
at [github.com/c2pa-org/public-testfiles](https://github.com/c2pa-org/public-testfiles),
maintained by the C2PA organisation as an interoperability and Conformance
testing corpus for C2PA validator implementations. Files are contributed by
C2PA Conforming Generator Products under the C2PA Conformance Program.

## License — Creative Commons BY-SA 4.0

The upstream repository is licensed under the
[Creative Commons Attribution-ShareAlike 4.0 International License (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/).

In plain English for anyone reading this repo:

- **You may** use, redistribute, modify, and build upon this directory's
  contents for any purpose, including commercial.
- **You must** credit the original contributors (see "Inventory" below).
- **Derivatives must be licensed under CC BY-SA 4.0** (ShareAlike). This
  clause binds adaptations of the content — e.g. transcoded versions of
  the video, manifest extractions, frame grabs. It does NOT bind the rest
  of this repository: the auditor source code remains licensed under
  Apache-2.0, because the MP4 is used as data, not adapted into the code.

This subtree is the only part of `ai-watermark-robustness-auditor` under
CC BY-SA 4.0. Everything else in the repo is Apache-2.0.

## Inventory

| Filename                            | SHA-256 (lowercase hex)                                              | Bytes       | Contributor | C2PA spec |
| ----------------------------------- | -------------------------------------------------------------------- | ----------- | ----------- | --------- |
| `truepic-20230212-zoetrope.mp4`     | `23db1d7891973ad0eed6f87967abc2e748663afddacfb0ceb839aa20848cfff3`   | 15,456,823  | Truepic     | C2PA 1.4  |

## Why this file is here

This is the only real decodable C2PA-signed video in the public
`c2pa-org/public-testfiles` repository as of pull time, and it's the
primary video corpus item for which the attack battery (re-encode,
platform-sim, ABR ladder, container strip) produces a meaningful
robustness measurement. The Adobe `c2pa-js` samples we also redistribute
include a `dashinit.mp4` — but that is a DASH initialisation segment
(moov-only, ~5 KB, no decodable media), useful only for the container
strip attack. This Truepic sample exercises every attack in the battery.

## Upstream location

Original path within the upstream repo:
`legacy/1.4/video/mp4/truepic-20230212-zoetrope.mp4`

Permalink (main branch at the time of redistribution):
https://github.com/c2pa-org/public-testfiles/blob/main/legacy/1.4/video/mp4/truepic-20230212-zoetrope.mp4
