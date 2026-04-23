import type { Detector } from "./types.js";
import { nullDetector } from "./null.js";
import { c2paDetector } from "./c2pa.js";
import { xmpDstDetector } from "./xmp-dst.js";

/**
 * The default detector set. `nullDetector` stays in as a negative control —
 * see its module doc for why. Real detectors to add next:
 *
 *   - `digimarc`     — native SDK wrapper (commercial license required)
 *   - `hive`         — HTTPS call to Hive's detection API
 *   - `synthid`      — Google public-preview detector if/when published
 *   - `truepic`      — Truepic Lens verify SDK
 *
 * A detector is considered "launchable" once it has: a deterministic offline
 * mode OR a documented online SLA, a fixture set in tests/, and an entry in
 * docs/DETECTORS.md.
 */
export const defaultDetectors: readonly Detector[] = Object.freeze([
  c2paDetector,
  xmpDstDetector,
  nullDetector,
]);

export function getDetectorById(id: string): Detector | undefined {
  return defaultDetectors.find((d) => d.id === id);
}
