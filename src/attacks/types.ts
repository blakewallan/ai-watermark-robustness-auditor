import type { AttackCategory, CorpusItem } from "../types.js";

/**
 * Attacks are pure transformations: CorpusItem -> new media on disk. They do
 * NOT know about detectors. Keeping the boundary sharp means a third-party
 * vendor can contribute a detector without understanding the attack surface,
 * and vice-versa.
 */
export interface Attack {
  readonly id: string;
  readonly category: AttackCategory;
  readonly title: string;
  readonly description: string;
  readonly methodologyRef: string;
  run(input: CorpusItem, ctx: AttackContext): Promise<AttackResult>;
}

export interface AttackContext {
  readonly workDir: string;
  readonly ffmpegPath: string;
}

export interface AttackResult {
  readonly attackId: string;
  readonly inputId: string;
  readonly outputPath: string;
  readonly durationMs: number;
  readonly stderrTail?: string;
}
