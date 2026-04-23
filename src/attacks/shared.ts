/**
 * Shared helpers for attack modules. Intentionally tiny — the goal is to
 * avoid copy-pasting the same three utilities across every attack file, not
 * to become a dumping ground for attack logic. Attack-specific logic stays
 * in its own module.
 */

export class AttackError extends Error {
  readonly stderrTail: string;
  constructor(message: string, stderrTail: string) {
    super(message);
    this.name = "AttackError";
    this.stderrTail = stderrTail;
  }
}

/** Last `n` lines of `text`, trimmed. Useful for surfacing the tail of
 *  ffmpeg's stderr in error messages without blasting a megabyte into logs. */
export function tailLines(text: string, n: number): string {
  if (!text) return "";
  return text.split(/\r?\n/).slice(-n).join("\n");
}
