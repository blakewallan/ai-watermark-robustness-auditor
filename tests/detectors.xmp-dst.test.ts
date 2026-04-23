import { describe, it, expect } from "vitest";
import {
  classifyXmpScan,
  scanBytesForXmpDst,
  xmpDstDetector,
  type XmpDstScan,
} from "../src/detectors/xmp-dst.js";

const IPTC_ROOT = "http://cv.iptc.org/newscodes/digitalsourcetype/";
const C2PA_ROOT = "http://c2pa.org/digitalsourcetype/";

function envelope(body: string): string {
  return (
    `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>` +
    `<x:xmpmeta xmlns:x="adobe:ns:meta/">` +
    `<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" ` +
    `xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/">` +
    body +
    `</rdf:RDF></x:xmpmeta>` +
    `<?xpacket end="w"?>`
  );
}

function wrapInBinary(xmp: string): Uint8Array {
  // Simulate an ISOBMFF-ish container by padding with arbitrary bytes on
  // either side. Gives the scanner a non-zero packetOffset to report.
  const head = Buffer.from(new Uint8Array(128).fill(0x00));
  const xmpBuf = Buffer.from(xmp, "utf-8");
  const tail = Buffer.from(new Uint8Array(64).fill(0xff));
  return Buffer.concat([head, xmpBuf, tail]);
}

describe("scanBytesForXmpDst", () => {
  it("reports xmpPresent=false when there is no XMP packet", () => {
    const bytes = Buffer.from("plain binary garbage\x00\x01\x02");
    expect(scanBytesForXmpDst(bytes)).toEqual<XmpDstScan>({
      xmpPresent: false,
    });
  });

  it("finds DST in attribute form (Iptc4xmpExt: prefix)", () => {
    const xmp = envelope(
      `<rdf:Description Iptc4xmpExt:DigitalSourceType="${IPTC_ROOT}trainedAlgorithmicMedia"/>`,
    );
    const scan = scanBytesForXmpDst(wrapInBinary(xmp));
    expect(scan.xmpPresent).toBe(true);
    expect(scan.packetOffset).toBe(128);
    expect(scan.digitalSourceType).toBe(
      `${IPTC_ROOT}trainedAlgorithmicMedia`,
    );
    expect(scan.classification).toBe("ai-generated");
  });

  it("finds DST in element form", () => {
    const xmp = envelope(
      `<rdf:Description>` +
        `<Iptc4xmpExt:DigitalSourceType>${IPTC_ROOT}digitalCapture</Iptc4xmpExt:DigitalSourceType>` +
        `</rdf:Description>`,
    );
    const scan = scanBytesForXmpDst(wrapInBinary(xmp));
    expect(scan.digitalSourceType).toBe(`${IPTC_ROOT}digitalCapture`);
    expect(scan.classification).toBe("human");
  });

  it("accepts the short `iptcExt:` prefix seen in some producer output", () => {
    const xmp = envelope(
      `<rdf:Description iptcExt:DigitalSourceType="${IPTC_ROOT}algorithmicMedia"/>`,
    );
    const scan = scanBytesForXmpDst(wrapInBinary(xmp));
    expect(scan.digitalSourceType).toBe(`${IPTC_ROOT}algorithmicMedia`);
    expect(scan.classification).toBe("ai-generated");
  });

  it("classifies C2PA trainedAlgorithmicData as ai-training-data", () => {
    const xmp = envelope(
      `<rdf:Description Iptc4xmpExt:DigitalSourceType="${C2PA_ROOT}trainedAlgorithmicData"/>`,
    );
    const scan = scanBytesForXmpDst(wrapInBinary(xmp));
    expect(scan.classification).toBe("ai-training-data");
  });

  it("classifies composite URIs as ai-modified", () => {
    const xmp = envelope(
      `<rdf:Description Iptc4xmpExt:DigitalSourceType="${IPTC_ROOT}compositeWithTrainedAlgorithmicMedia"/>`,
    );
    const scan = scanBytesForXmpDst(wrapInBinary(xmp));
    expect(scan.classification).toBe("ai-modified");
  });

  it("classifies unknown suffixes as unknown without throwing", () => {
    const xmp = envelope(
      `<rdf:Description Iptc4xmpExt:DigitalSourceType="${IPTC_ROOT}madeUpInThe2030s"/>`,
    );
    const scan = scanBytesForXmpDst(wrapInBinary(xmp));
    expect(scan.digitalSourceType).toBe(`${IPTC_ROOT}madeUpInThe2030s`);
    expect(scan.classification).toBe("unknown");
  });

  it("reports xmpPresent=true but no URI when the packet lacks DST", () => {
    const xmp = envelope(
      `<rdf:Description dc:title="no disclosure here"/>`,
    );
    const scan = scanBytesForXmpDst(wrapInBinary(xmp));
    expect(scan.xmpPresent).toBe(true);
    expect(scan.digitalSourceType).toBeUndefined();
    expect(scan.classification).toBeUndefined();
  });
});

describe("classifyXmpScan", () => {
  it("no XMP → detected=false with reason xmp-absent", () => {
    const r = classifyXmpScan({ xmpPresent: false });
    expect(r.detectorId).toBe("detector.xmp-dst");
    expect(r.detected).toBe(false);
    expect(r.confidence).toBe(0);
    expect(r.evidence?.["reason"]).toBe("xmp-absent");
  });

  it("XMP present but no DST → detected=false with reason xmp-present-no-dst", () => {
    const r = classifyXmpScan({ xmpPresent: true, packetOffset: 100 });
    expect(r.detected).toBe(false);
    expect(r.confidence).toBe(0);
    expect(r.evidence?.["reason"]).toBe("xmp-present-no-dst");
  });

  it("DST URI present → detected=true @ confidence 1", () => {
    const r = classifyXmpScan({
      xmpPresent: true,
      packetOffset: 128,
      digitalSourceType: `${IPTC_ROOT}trainedAlgorithmicMedia`,
      classification: "ai-generated",
    });
    expect(r.detected).toBe(true);
    expect(r.confidence).toBe(1);
    expect(r.evidence?.["reason"]).toBe("dst-present");
    expect(r.evidence?.["digitalSourceType"]).toBe(
      `${IPTC_ROOT}trainedAlgorithmicMedia`,
    );
    expect(r.evidence?.["classification"]).toBe("ai-generated");
    expect(r.evidence?.["packetOffset"]).toBe(128);
  });

  it("human-origin DST is still detected=true (signal is binary)", () => {
    // Important property: the detector does not gate on semantic category.
    // Whether the producer claimed 'digitalCapture' or 'trainedAlgorithmicMedia',
    // the robustness question is "did the disclosure field survive at all?"
    const r = classifyXmpScan({
      xmpPresent: true,
      digitalSourceType: `${IPTC_ROOT}digitalCapture`,
      classification: "human",
    });
    expect(r.detected).toBe(true);
    expect(r.confidence).toBe(1);
  });
});

describe("xmpDstDetector", () => {
  it("exposes the expected identity", () => {
    expect(xmpDstDetector.id).toBe("detector.xmp-dst");
    expect(xmpDstDetector.watermarkKind).toBe("iptc-xmp");
  });

  it("returns an errorMessage when the file cannot be read", async () => {
    const r = await xmpDstDetector.detect(
      "C:/definitely/does/not/exist.mp4",
      { workDir: "." },
    );
    expect(r.detected).toBe(false);
    expect(r.confidence).toBe(0);
    expect(r.errorMessage).toMatch(/Could not read/);
  });
});
