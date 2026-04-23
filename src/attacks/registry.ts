import type { Attack } from "./types.js";
import { reencodeH264Crf23 } from "./reencode.js";
import { platformSimYoutube1080p } from "./platform-sim-youtube.js";
import { abrLadderHlsDefault } from "./abr-ladder.js";
import { containerStripC2pa } from "./container-strip-c2pa.js";
import { containerStripXmp } from "./xmp-strip.js";

/**
 * The default attack battery. New attacks should be added here and
 * documented in `docs/ATTACKS.md` in the same pull request.
 *
 * Keep the ordering stable — report readers compare attack columns across
 * runs and a reshuffle will look like a diff even when nothing changed.
 * Ordering here is: cheap-and-gentle first, adversarial last.
 */
export const defaultAttacks: readonly Attack[] = Object.freeze([
  reencodeH264Crf23,
  platformSimYoutube1080p,
  abrLadderHlsDefault,
  containerStripC2pa,
  containerStripXmp,
]);

export function getAttackById(id: string): Attack | undefined {
  return defaultAttacks.find((a) => a.id === id);
}
