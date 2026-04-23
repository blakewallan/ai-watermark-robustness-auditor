# Adobe `c2pa-js` test assets — redistribution notice

The files in this directory originate from the open-source
[`contentauth/c2pa-js`](https://github.com/contentauth/c2pa-js) repository
(specifically `packages/c2pa-web/test/assets/`) and are redistributed
here under the terms of that project's MIT license.

## License

> MIT License
>
> © Copyright 2025 Adobe. All rights reserved.
>
> Permission is hereby granted, free of charge, to any person obtaining a
> copy of this software and associated documentation files (the
> "Software"), to deal in the Software without restriction, including
> without limitation the rights to use, copy, modify, merge, publish,
> distribute, sublicense, and/or sell copies of the Software, and to
> permit persons to whom the Software is furnished to do so, subject to
> the following conditions:
>
> The above copyright notice and this permission notice shall be
> included in all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
> EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
> MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
> IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
> CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
> TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
> SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Inventory

Every file in this directory is covered by the notice above.

| Filename                                     | SHA-256 (lowercase hex)                                              | Bytes    |
| -------------------------------------------- | -------------------------------------------------------------------- | -------- |
| `C.jpg`                                      | `a2d14755db55de67a47c04090340d8266e892367be4104a45626d7a6fa6e9ffd`   |  132,518 |
| `C_with_CAWG_data.jpg`                       | `fa0b257c863cb5b367135a017813ce0c1fbfc690a03e94acdd047c25c2d1ed46`   |  139,636 |
| `C_with_CAWG_data_thumbnail.jpg`             | `c13676faf4036e8847f6bce61734376bf8c14fe5f1bc66ae85a2c3106e0fc300`   |   26,868 |
| `dash1.m4s`                                  | `6967526d29a85a1246c56850a20fa545cf900798e58492bb73cd34a229666e80`   |   71,111 |
| `dashinit.mp4`                               | `98932f75cc3f796ce77bbb3b7306c9e09756b099d7fd4335219eec73a9ea0bf8`   |    4,765 |
| `no_alg.jpg`                                 | `7c91641416c18319b823c292ae603c5354892ac365c05543519154c48c6a1f8a`   |   86,499 |
| `PirateShip_save_credentials_to_cloud.jpg`   | `54620b5f7b7bfd657f74732064ca3cb509f512072c1ee9bd03d5f3f1a0bc8d5f`   |  479,426 |

## Why these files are here

They are the canonical test corpus the CAI uses to exercise their own
`c2pa-web` WASM reader. Using the same corpus for our robustness
auditor means findings are directly comparable to CAI's own reader
behaviour — a buyer of our report can go to the CAI repo, run their
reader on the identical bytes, and confirm the baseline. Replacing
them with our own re-signed samples would introduce a trust gap that
is unnecessary and easy to avoid.
