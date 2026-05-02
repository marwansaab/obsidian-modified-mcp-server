import { describe, it, expect } from 'vitest';

import { assembleResult } from '../../../src/tools/find-and-replace/response-builder.js';

import type { PerFileResult } from '../../../src/tools/find-and-replace/types.js';

function modified(filename: string, replacements: number, matchesInSkippedRegions = 0): PerFileResult {
  return {
    filename,
    replacements,
    matchesInSkippedRegions,
    outcome: 'modified',
    inputSizeBytes: 100,
    outputSizeBytes: 110,
  };
}

function noop(filename: string, matchesInSkippedRegions = 0): PerFileResult {
  return {
    filename,
    replacements: 0,
    matchesInSkippedRegions,
    outcome: 'no-op',
    inputSizeBytes: 100,
    outputSizeBytes: 100,
  };
}

function skippedSize(filename: string, sizeBytes: number): PerFileResult {
  return {
    filename,
    replacements: 0,
    matchesInSkippedRegions: 0,
    outcome: 'skipped',
    skipReason: 'size_exceeded',
    inputSizeBytes: sizeBytes,
    outputSizeBytes: 0,
  };
}

function failed(filename: string, error: string): PerFileResult {
  return {
    filename,
    replacements: 0,
    matchesInSkippedRegions: 0,
    outcome: 'failed',
    error,
    inputSizeBytes: 100,
    outputSizeBytes: 0,
  };
}

describe('response-builder (T009/T009a)', () => {
  it('aggregates counters correctly across modified, no-op, skipped, failed', () => {
    const result = assembleResult({
      perFileResults: [
        modified('a.md', 2),
        modified('b.md', 3),
        noop('c.md'),
        skippedSize('big.md', 6_000_000),
        failed('broken.md', 'Obsidian API Error 503: Service Unavailable'),
      ],
      resolvedVaultId: 'default',
      pathPrefix: null,
      dryRun: false,
      verbose: false,
    });

    expect(result.ok).toBe(false); // failures present
    expect(result.dryRun).toBe(false);
    expect(result.vaultId).toBe('default');
    expect(result.pathPrefix).toBeNull();
    expect(result.filesScanned).toBe(4); // a, b, c, broken (skipped doesn't count)
    expect(result.filesModified).toBe(2);
    expect(result.filesSkipped).toBe(1);
    expect(result.totalReplacements).toBe(5);
    expect(result.totalMatchesInSkippedRegions).toBe(0);
  });

  it('omits empty arrays (failures: [], skipped: [], perFile: [] all hidden)', () => {
    const result = assembleResult({
      perFileResults: [modified('a.md', 1)],
      resolvedVaultId: 'default',
      pathPrefix: null,
      dryRun: false,
      verbose: false, // perFile suppressed
    });
    expect(result.failures).toBeUndefined();
    expect(result.skipped).toBeUndefined();
    expect(result.perFile).toBeUndefined();
    expect(result.ok).toBe(true);
  });

  it('sorts perFile/failures/skipped by filename ascending lex UTF-8 (FR-020c)', () => {
    const result = assembleResult({
      perFileResults: [
        modified('zebra.md', 1),
        modified('alpha.md', 1),
        modified('mango.md', 1),
        skippedSize('zoo.md', 6_000_000),
        skippedSize('apple.md', 6_000_000),
        failed('zfailed.md', 'err'),
        failed('afailed.md', 'err'),
      ],
      resolvedVaultId: 'default',
      pathPrefix: null,
      dryRun: false,
      verbose: true,
    });
    expect(result.perFile?.map((e) => e.filename)).toEqual(['alpha.md', 'mango.md', 'zebra.md']);
    expect(result.skipped?.map((e) => e.filename)).toEqual(['apple.md', 'zoo.md']);
    expect(result.failures?.map((e) => e.filename)).toEqual(['afailed.md', 'zfailed.md']);
  });

  it('counts matchesInSkippedRegions on no-op and modified files alike (FR-020b)', () => {
    const result = assembleResult({
      perFileResults: [
        modified('a.md', 1, 2),
        noop('b.md', 3),
      ],
      resolvedVaultId: 'default',
      pathPrefix: null,
      dryRun: false,
      verbose: false,
    });
    expect(result.totalMatchesInSkippedRegions).toBe(5);
  });

  it('totalMatchesInSkippedRegions equals zero when neither skip flag was set', () => {
    const result = assembleResult({
      perFileResults: [modified('a.md', 1, 0), modified('b.md', 2, 0)],
      resolvedVaultId: 'default',
      pathPrefix: null,
      dryRun: false,
      verbose: false,
    });
    expect(result.totalMatchesInSkippedRegions).toBe(0);
  });

  it('echoes resolvedVaultId and pathPrefix in the response', () => {
    const result = assembleResult({
      perFileResults: [],
      resolvedVaultId: 'research',
      pathPrefix: 'Projects',
      dryRun: true,
      verbose: false,
    });
    expect(result.vaultId).toBe('research');
    expect(result.pathPrefix).toBe('Projects');
    expect(result.dryRun).toBe(true);
  });

  it('SC-006 — empty-result response for 5,000-file synthetic enumeration is under 500 bytes when verbose:false', () => {
    const perFileResults: PerFileResult[] = [];
    for (let i = 0; i < 5000; i += 1) {
      perFileResults.push(noop(`file-${i}.md`));
    }
    const result = assembleResult({
      perFileResults,
      resolvedVaultId: 'default',
      pathPrefix: null,
      dryRun: false,
      verbose: false, // no perFile array — SC-006 condition
    });
    const serialized = JSON.stringify(result);
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThan(500);
    expect(result.filesScanned).toBe(5000);
    expect(result.filesModified).toBe(0);
    expect(result.totalReplacements).toBe(0);
  });

  it('R16 — applies 1 MB response cap with responseTruncated:true for large verbose responses', () => {
    // Construct enough perFile entries to exceed 1 MB when JSON-stringified.
    // Each entry has filename ~100 chars + a previews array → roughly 350 B
    // serialized; ~5,000 entries clears the 1 MB cap.
    const perFileResults: PerFileResult[] = [];
    const longFilename = 'A'.repeat(80);
    const longContext = 'X'.repeat(40);
    for (let i = 0; i < 5000; i += 1) {
      perFileResults.push({
        filename: `${longFilename}-${i.toString().padStart(4, '0')}.md`,
        replacements: 5,
        matchesInSkippedRegions: 0,
        outcome: 'modified',
        inputSizeBytes: 1000,
        outputSizeBytes: 1000,
        previews: [
          {
            matchIndex: 1,
            lineNumber: 1,
            columnStart: 1,
            before: longContext,
            match: 'AcmeWidget',
            replacement: 'Globex',
            after: longContext,
          },
          {
            matchIndex: 2,
            lineNumber: 5,
            columnStart: 12,
            before: longContext,
            match: 'AcmeWidget',
            replacement: 'Globex',
            after: longContext,
          },
          {
            matchIndex: 3,
            lineNumber: 9,
            columnStart: 1,
            before: longContext,
            match: 'AcmeWidget',
            replacement: 'Globex',
            after: longContext,
          },
        ],
      });
    }
    const result = assembleResult({
      perFileResults,
      resolvedVaultId: 'default',
      pathPrefix: null,
      dryRun: false,
      verbose: true,
    });
    const serialized = JSON.stringify(result);
    expect(Buffer.byteLength(serialized, 'utf8')).toBeLessThanOrEqual(1 * 1024 * 1024);
    expect(result.responseTruncated).toBe(true);
  });

  it('T034 — totalMatchesInSkippedRegions reflects only matches in skipped regions, not totalReplacements', () => {
    // File modified with 5 actual replacements and 3 matches that
    // fell inside skipped regions (and were therefore preserved).
    const result = assembleResult({
      perFileResults: [
        modified('a.md', 5, 3),
        modified('b.md', 2, 1),
      ],
      resolvedVaultId: 'default',
      pathPrefix: null,
      dryRun: false,
      verbose: false,
    });
    expect(result.totalReplacements).toBe(7);
    expect(result.totalMatchesInSkippedRegions).toBe(4);
  });

  it('T034 — counts matchesInSkippedRegions on a no-op file (US3 audit-trail-only file)', () => {
    // A file where ALL matches were inside skipped regions, so the
    // post-replacement output is byte-identical to the input.
    const result = assembleResult({
      perFileResults: [noop('audit.md', 4)],
      resolvedVaultId: 'default',
      pathPrefix: null,
      dryRun: false,
      verbose: false,
    });
    expect(result.filesModified).toBe(0);
    expect(result.totalReplacements).toBe(0);
    expect(result.totalMatchesInSkippedRegions).toBe(4);
  });

  it('skipped entry with output_size_exceeded includes outputSizeBytes', () => {
    const result = assembleResult({
      perFileResults: [
        {
          filename: 'expansive.md',
          replacements: 0,
          matchesInSkippedRegions: 0,
          outcome: 'skipped',
          skipReason: 'output_size_exceeded',
          inputSizeBytes: 4_000_000,
          outputSizeBytes: 6_000_000,
        },
      ],
      resolvedVaultId: 'default',
      pathPrefix: null,
      dryRun: false,
      verbose: false,
    });
    expect(result.skipped?.[0]?.reason).toBe('output_size_exceeded');
    expect(result.skipped?.[0]?.outputSizeBytes).toBe(6_000_000);
  });
});
