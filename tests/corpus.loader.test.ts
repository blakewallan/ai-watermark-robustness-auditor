import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadCorpus,
  sha256File,
  CorpusLoadError,
} from "../src/corpus/loader.js";

async function withTempCorpus(
  fixtureFiles: Record<string, string | Buffer>,
  corpusJson: unknown,
  run: (corpusJsonPath: string, dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "corpus-test-"));
  try {
    for (const [rel, contents] of Object.entries(fixtureFiles)) {
      const target = path.join(dir, rel);
      await writeFile(target, contents);
    }
    const jsonPath = path.join(dir, "corpus.json");
    await writeFile(jsonPath, JSON.stringify(corpusJson, null, 2));
    await run(jsonPath, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("loadCorpus", () => {
  it("loads a minimal valid manifest and resolves paths relative to it", async () => {
    await withTempCorpus(
      { "a.mp4": Buffer.from([1, 2, 3]) },
      {
        version: 1,
        items: [
          {
            id: "a",
            label: "A",
            path: "a.mp4",
            expectedWatermarks: ["c2pa"],
          },
        ],
      },
      async (jsonPath, dir) => {
        const items = await loadCorpus(jsonPath);
        expect(items).toHaveLength(1);
        expect(items[0]!.id).toBe("a");
        expect(items[0]!.path).toBe(path.join(dir, "a.mp4"));
        expect(items[0]!.expectedWatermarks).toEqual(["c2pa"]);
      },
    );
  });

  it("preserves optional metadata (license, source, notes, sha256)", async () => {
    await withTempCorpus(
      { "a.mp4": Buffer.from([1, 2, 3]) },
      {
        version: 1,
        items: [
          {
            id: "a",
            label: "A",
            path: "a.mp4",
            expectedWatermarks: ["c2pa"],
            license: "MIT",
            source: "https://example.com/a.mp4",
            notes: "ref sample",
            sha256:
              "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
          },
        ],
      },
      async (jsonPath) => {
        const items = await loadCorpus(jsonPath);
        const it = items[0]!;
        expect(it.license).toBe("MIT");
        expect(it.source).toBe("https://example.com/a.mp4");
        expect(it.notes).toBe("ref sample");
        expect(it.sha256).toBe(
          "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
        );
      },
    );
  });

  it("rejects unknown schema versions", async () => {
    await withTempCorpus(
      {},
      { version: 99, items: [] },
      async (jsonPath) => {
        await expect(loadCorpus(jsonPath)).rejects.toThrow(CorpusLoadError);
      },
    );
  });

  it("rejects duplicate item ids", async () => {
    await withTempCorpus(
      { "a.mp4": Buffer.from([1]), "b.mp4": Buffer.from([2]) },
      {
        version: 1,
        items: [
          { id: "dup", label: "A", path: "a.mp4", expectedWatermarks: ["c2pa"] },
          { id: "dup", label: "B", path: "b.mp4", expectedWatermarks: ["c2pa"] },
        ],
      },
      async (jsonPath) => {
        await expect(loadCorpus(jsonPath)).rejects.toThrow(/Duplicate corpus item id/);
      },
    );
  });

  it("rejects unknown watermark kinds", async () => {
    await withTempCorpus(
      { "a.mp4": Buffer.from([1]) },
      {
        version: 1,
        items: [
          {
            id: "a",
            label: "A",
            path: "a.mp4",
            expectedWatermarks: ["fake-watermark-kind"],
          },
        ],
      },
      async (jsonPath) => {
        await expect(loadCorpus(jsonPath)).rejects.toThrow(/unknown watermark kind/);
      },
    );
  });

  it("rejects malformed sha256 hex", async () => {
    await withTempCorpus(
      { "a.mp4": Buffer.from([1]) },
      {
        version: 1,
        items: [
          {
            id: "a",
            label: "A",
            path: "a.mp4",
            expectedWatermarks: ["c2pa"],
            sha256: "not-a-hash",
          },
        ],
      },
      async (jsonPath) => {
        await expect(loadCorpus(jsonPath)).rejects.toThrow(/malformed sha256/);
      },
    );
  });

  it("verifies file hashes when verifyHashes=true", async () => {
    const bytes = Buffer.from("hello, c2pa");
    await withTempCorpus(
      { "a.mp4": bytes },
      {
        version: 1,
        items: [
          {
            id: "a",
            label: "A",
            path: "a.mp4",
            expectedWatermarks: ["c2pa"],
            // wrong hash on purpose
            sha256:
              "0000000000000000000000000000000000000000000000000000000000000000",
          },
        ],
      },
      async (jsonPath) => {
        await expect(
          loadCorpus(jsonPath, { verifyHashes: true }),
        ).rejects.toThrow(/sha256 mismatch/);
      },
    );
  });

  it("passes hash verification when the hash is correct", async () => {
    const bytes = Buffer.from("hello, c2pa");
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(bytes).digest("hex");
    await withTempCorpus(
      { "a.mp4": bytes },
      {
        version: 1,
        items: [
          {
            id: "a",
            label: "A",
            path: "a.mp4",
            expectedWatermarks: ["c2pa"],
            sha256: hash,
          },
        ],
      },
      async (jsonPath) => {
        const items = await loadCorpus(jsonPath, { verifyHashes: true });
        expect(items[0]!.sha256).toBe(hash);
      },
    );
  });

  it("gives a clear error when the file does not exist", async () => {
    await expect(
      loadCorpus(path.join(tmpdir(), "no-such-file-xyz.json")),
    ).rejects.toThrow(CorpusLoadError);
  });

  it("gives a clear error on invalid JSON", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "corpus-test-"));
    try {
      const jsonPath = path.join(dir, "corpus.json");
      await writeFile(jsonPath, "{ not json");
      await expect(loadCorpus(jsonPath)).rejects.toThrow(/not valid JSON/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads the bundled adobe-c2pa-js corpus if present", async () => {
    // This test pins the bundled corpus to ensure we don't accidentally
    // break it with a loader change. Skipped gracefully if the corpus
    // file is not in the expected location (e.g. partial checkout).
    const bundled = path.resolve(
      path.dirname(new URL(import.meta.url).pathname.replace(/^\//, "")),
      "..",
      "corpus",
      "corpus.json",
    );
    try {
      const items = await loadCorpus(bundled, { verifyHashes: true });
      expect(items.length).toBeGreaterThanOrEqual(1);
      for (const it of items) {
        expect(it.id).toBeTruthy();
        expect(it.expectedWatermarks.length).toBeGreaterThan(0);
      }
    } catch (err) {
      if (err instanceof CorpusLoadError && /Could not read/.test(err.message)) {
        // Bundled corpus missing — test is advisory only.
        return;
      }
      throw err;
    }
  });
});

describe("sha256File", () => {
  it("computes the standard hash of a known string", async () => {
    await withTempCorpus(
      { "x.txt": Buffer.from("abc") },
      { version: 1, items: [] },
      async (_, dir) => {
        const hash = await sha256File(path.join(dir, "x.txt"));
        expect(hash).toBe(
          "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        );
      },
    );
  });
});
