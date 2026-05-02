/**
 * find_and_replace tool: SC-001 performance benchmark (T048a).
 *
 * Synthetic benchmark: construct a 1,000-`.md`-file mocked vault and
 * run a literal sweep with dryRun: false. Asserts total wall-time
 * under 30 seconds — the SC-001 target.
 *
 * Smoke benchmark: the assertion is informational against a generous
 * bound rather than a tight perf gate. The actual time is logged so
 * regressions are visible in test output even if the absolute bound
 * isn't tripped.
 */

import { describe, it, expect } from 'vitest';

import { runFindAndReplace } from '../../../src/tools/find-and-replace/find-and-replace.js';

import type { ObsidianRestService } from '../../../src/services/obsidian-rest.js';

function buildLargeFakeVault(numFiles: number, contentPerFile: string): ObsidianRestService {
  const files: string[] = [];
  const vault = new Map<string, string>();
  for (let i = 0; i < numFiles; i += 1) {
    const name = `note-${i.toString().padStart(4, '0')}.md`;
    files.push(name);
    vault.set(name, contentPerFile);
  }

  const fakeRest = {
    listFilesInVault: async () => files,
    listFilesInDir: async () => [] as string[],
    getFileContents: async (filepath: string) => {
      const c = vault.get(filepath);
      if (c === undefined) throw new Error(`Not found: ${filepath}`);
      return c;
    },
    putContent: async (filepath: string, content: string) => {
      vault.set(filepath, content);
    },
  };

  return fakeRest as unknown as ObsidianRestService;
}

describe('SC-001 — 1,000-note vault benchmark', () => {
  it('sweeps 1,000 notes in under 30 seconds (SC-001 generous bound)', async () => {
    const noteContent =
      '# Title\n\nLorem ipsum AcmeWidget dolor sit amet, consectetur adipiscing elit.\n' +
      'Sed do eiusmod tempor incididunt AcmeWidget ut labore et dolore magna aliqua.\n';
    const rest = buildLargeFakeVault(1000, noteContent);

    const start = Date.now();
    const result = await runFindAndReplace(
      rest,
      { search: 'AcmeWidget', replacement: 'Globex' },
      'default',
    );
    const elapsedMs = Date.now() - start;

    // Log for visibility — regressions show up here even if the
    // hard bound isn't tripped.
    console.log(`[SC-001 benchmark] 1,000 notes swept in ${elapsedMs} ms`);

    expect(result.filesScanned).toBe(1000);
    expect(result.filesModified).toBe(1000);
    expect(result.totalReplacements).toBe(2000); // 2 matches per note
    expect(elapsedMs).toBeLessThan(30_000); // SC-001 generous bound
  }, 60_000);

  it('sweeps 1,000 notes in under 30 seconds with dryRun: true (SC-001 + FR-015)', async () => {
    const noteContent =
      'AcmeWidget here, AcmeWidget there, AcmeWidget everywhere.\n';
    const rest = buildLargeFakeVault(1000, noteContent);

    const start = Date.now();
    const result = await runFindAndReplace(
      rest,
      { search: 'AcmeWidget', replacement: 'Globex', dryRun: true },
      'default',
    );
    const elapsedMs = Date.now() - start;

    console.log(`[SC-001 benchmark dryRun] 1,000 notes swept in ${elapsedMs} ms`);

    expect(result.filesScanned).toBe(1000);
    expect(result.filesModified).toBe(1000);
    expect(elapsedMs).toBeLessThan(30_000);
  }, 60_000);
});
