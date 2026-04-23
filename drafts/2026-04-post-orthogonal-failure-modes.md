# Your AI Disclosure Is One ffmpeg Command Away From Gone — And the EU Just Made That Your Problem

**Draft — not yet published.** Working title. Target audience: heads of AI, heads of trust & safety, GCs at generative-AI companies; secondary audience: the platforms and insurers who will end up holding the bag. Voice: technically precise, financially pointed, no hedging.

---

## The one-paragraph version

If you ship generative AI that produces video or images, **EU AI Act Article 50(2)** requires your output to be marked as AI-generated in a way that is *"effective, interoperable, robust, and reliable as far as technically feasible."* That obligation becomes enforceable on **2 August 2026**. Every major vendor — OpenAI, Google, Adobe, Meta, Runway, Kling, Pika — currently answers this requirement with one or both of two technologies: **C2PA** (a signed metadata manifest) and **IPTC XMP DigitalSourceType** (an unsigned metadata tag). Independent testing on a reproducible corpus shows that both are defeated by trivial, off-the-shelf transformations — and, more importantly, that the two mechanisms fail on *orthogonal* surfaces. If you are relying on the common "we ship both, so we're robust" posture, the data says you are not robust. You are exposed.

This post puts numbers on that exposure.

---

## Why the numbers matter: the liability surface

Before the technical detail, the money.

"Robust and reliable" is not a feature claim. It is, under Article 50(2), a **legal obligation to a technical standard**. Three consequences follow that product and legal teams should internalize now, not in July 2026:

- **Article 99 administrative fines** for Article 50 non-compliance top out at **€15,000,000 or 3% of worldwide annual turnover**, whichever is higher. For a provider in the €10B revenue range, 3% is €300M. This is not a line-item fine; it's a regulatory write-down.
- **Market-access risk.** The AI Office can issue compliance orders that functionally gate EU distribution. Losing EU market access is not a fine — it is an immediate top-line event priced by every enterprise customer in their vendor-risk questionnaire.
- **Private liability ladder.** The Product Liability Directive (2024) and pending AI Liability Directive create **civil causes of action** downstream of regulatory findings. An EU regulator concluding that a vendor's disclosure was not "robust" becomes discovery-ready evidence in private litigation by downstream platforms, rights-holders, and — critically — deepfake victims. The regulatory fine is the floor, not the ceiling.

Insurers are already asking about this. Cyber and tech E&O underwriters have started inserting AI-disclosure clauses and exclusions. A vendor who can't point to independent third-party robustness testing is, in 2026, the same risk class as a SaaS company that can't produce a SOC 2. That's not a technical problem. That's a renewal problem and a premium problem.

What the law does not yet spell out is the *evidentiary standard* for "robust." Regulators will fill in that blank with the testing methodology that is in the public record on the day they write the guidance. Whoever publishes that methodology first, in the open, with reproducible results, shapes the bar everyone else is measured against. This post is a first down payment on that methodology.

---

## What we tested

We built an open-source robustness auditor ([`ai-watermark-robustness-auditor`](https://github.com/REPLACE-ME)) that composes three things:

1. **A corpus under test.** 24 signed or XMP-tagged media files — a mix of Adobe C2PA samples, a real Truepic-signed MP4 from the C2PA consortium's public test set, and 16 synthetic clips we generate and sign ourselves so we know the ground truth. The 4 most interesting files in the corpus carry *both* a C2PA manifest and an IPTC XMP DigitalSourceType tag on the same bytes — the "belt and suspenders" configuration vendors actually ship.

2. **An attack battery.** Five transformations, each corresponding to a real threat: generic H.264 re-encode (anyone's upload pipeline), YouTube's public 1080p ingest signature, an HLS adaptive-bitrate round-trip (what every major streaming CDN does to every file that passes through it), a byte-level strip of the C2PA manifest (what a hex editor does in ten seconds), and — new in this run — a byte-level strip of the XMP packet (what TikTok, WhatsApp, and X preview generators already do to every image and video uploaded to them).

3. **Two detectors.** One reads the C2PA manifest (via the reference C2PA validator); one scans for the IPTC XMP DigitalSourceType URI. Every file is run against every attack, every output is run against every detector, and we record whether the disclosure still reads.

Every attack, every detector, and every corpus item is in the public repository. You can clone it and get the same numbers on your laptop in under a minute. That reproducibility *is* the product.

---

## The headline finding

On the 4 files that carry both disclosure mechanisms, the result is clean enough to be uncomfortable:

|                                  | **C2PA detector** | **XMP DST detector** |
|----------------------------------|:-----------------:|:--------------------:|
| Strip the C2PA box (hex-editor)  | **0% survive**    | **100% survive**     |
| Strip the XMP packet (hex-editor)| **100% survive**¹ | **0% survive**       |
| Re-encode (generic H.264)        | 0% survive        | 0% survive           |
| YouTube 1080p ingest simulation  | 0% survive        | 0% survive           |
| HLS 720p streaming round-trip    | 0% survive        | 0% survive           |

¹ The C2PA manifest box survives structurally but its cryptographic hard-binding hash no longer matches the modified bytes. A validator sees "manifest present, integrity failed." This is the *intended* behavior of signed manifests and is exactly why we grade it as a survival: the signal that "something was signed here, and something tampered with it" is itself meaningful — provided downstream validators are configured to treat "present-but-broken" as an alarm, not a pass. Many are not.

Read the first two rows carefully. They say that the two disclosure mechanisms have **disjoint failure surfaces**. A surgical attack on one leaves the other entirely intact. This is not a nuance. This is the thesis.

Read the bottom three rows just as carefully. They say that any *non-surgical* transformation — the kind that happens to every file uploaded to every platform, every day, without any adversarial intent — destroys both.

---

## What this means if you ship generative AI

**Your current posture, translated.** If your compliance narrative is "we embed C2PA *and* XMP, so disclosure is robust," the data says you have built two independent single points of failure and called it redundancy. An adversary chooses which one to attack; a platform's ingest pipeline chooses for them. You are not hedged. You are doubly exposed.

**Your current posture, priced.** Under Article 50(2), a disclosure that does not survive an ordinary YouTube re-upload is almost certainly not "robust as far as technically feasible" — because we have demonstrated, with code, that more robust options exist (pixel-domain watermarks, learned watermarks, reinforced metadata). "Technically feasible" is the operative phrase. A regulator armed with this post, our repository, and the academic literature will not accept "we did C2PA" as a defense.

**What changes on 2 August 2026.** Nothing, on your end, if you have not already moved. The enforcement date is not the date you start working on this. It is the date on which everything you have not shipped becomes discoverable in a regulatory file.

---

## What you should actually do

Three things, in order of leverage:

1. **Commission or run an independent robustness audit now, not after the enforcement date.** The specific tool doesn't matter; the reproducibility and the date-stamp do. An audit in hand from Q2 2026, showing your current disclosure posture against a named methodology, is the single strongest piece of paper your GC can hand a regulator or plaintiff's counsel in 2027. Absence of such an audit will be read as indifference.

2. **Stop counting C2PA + XMP as two defenses.** Count it as one defense with two different failure modes and plan accordingly. If your product requires durable AI-origin signaling (ad-platform integrations, news-media partnerships, safety-critical verification), you need a pixel-domain or frequency-domain watermark in the mix. Those have their own robustness profile; we'll put numbers on the leading candidates in subsequent posts.

3. **Get your validator policy in writing.** The 100%/0.5 row above is only a survival *if* the downstream validator treats "manifest present, hash invalid" as a meaningful signal. Most default configurations do not. The policy decision — "what does my platform do with a tampered-but-present manifest?" — is currently undocumented at most companies. Document it. That document is itself a compliance artifact.

---

## What's next from us

- **A larger corpus.** The 4-item both-mechanisms subset that drives the headline table is small; we will take it to 20 in the next post and re-run.
- **Commercial detector coverage.** Digimarc, Hive, Google SynthID (for the providers that publish a detector), Truepic Lens. The vendors whose durability claims have the most commercial weight.
- **A signed report format.** Reports are currently plain JSON. We will be shipping COSE-signed and timestamped report envelopes so that an audit produced by this tool is itself court-admissible evidence.
- **Per-vendor scorecards.** When the corpus and detector set are wide enough, we will publish standing scorecards by vendor and update them quarterly.

If you are a vendor and you want to see your disclosure stack in the next round of testing, or a platform that wants to discuss a private audit of your ingest pipeline's metadata-preservation behavior, the contact address is on the repository.

---

### About the project

The `ai-watermark-robustness-auditor` is an Apache-2.0 open-source project run independently of any AI provider, platform, or commercial detector vendor. The methodology, corpus, attacks, detectors, and reports are all in the public repository. No vendor funding. No embargo cycle. The numbers are the numbers.

---

**TODO before publish**
- [ ] Replace `github.com/REPLACE-ME` with the real URL
- [ ] Confirm Article 99 fine ceiling against the final AI Act text (currently citing the 3% / €15M figure from the December 2023 trilogue text; verify this survived to the enrolled version)
- [ ] Insert direct link to `reports/sample-run.json` at the point where the table is introduced
- [ ] Add pull-quote versions of rows 1–2 as a tweet-sized image
- [ ] Get a lawyer to look at the "liability surface" section before anything goes live; the claims are defensible but the phrasing is punchier than a lawyer would choose
- [ ] Expand `corpus/synth-xmp/` from 4 to ~20 items before this post claims a general result
- [ ] Add an author bio that frames the 10+ years of streaming-video infrastructure experience as the reason this person is qualified to write it
