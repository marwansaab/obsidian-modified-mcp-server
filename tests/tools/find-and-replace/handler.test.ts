import { describe, it, expect } from 'vitest';

import { handleFindAndReplace } from '../../../src/tools/find-and-replace/handler.js';

import type { ObsidianRestService } from '../../../src/services/obsidian-rest.js';

/**
 * Minimal fake REST that backs onto a Map. Used to exercise handler.ts
 * end-to-end without the dispatcher / SDK layers.
 */
function buildFakeRest(initial: Record<string, string>) {
  const vault = new Map(Object.entries(initial));
  const puts: Array<{ filepath: string; content: string }> = [];

  function rootEntries(): string[] {
    const set = new Set<string>();
    for (const k of vault.keys()) {
      const slash = k.indexOf('/');
      if (slash === -1) {
        set.add(k);
      } else {
        set.add(k.slice(0, slash) + '/');
      }
    }
    return [...set];
  }

  function dirEntries(dirpath: string): string[] {
    const norm = dirpath.endsWith('/') ? dirpath : dirpath + '/';
    const set = new Set<string>();
    for (const k of vault.keys()) {
      if (!k.startsWith(norm)) continue;
      const rest = k.slice(norm.length);
      const slash = rest.indexOf('/');
      if (slash === -1) {
        set.add(rest);
      } else {
        set.add(rest.slice(0, slash) + '/');
      }
    }
    return [...set];
  }

  const fakeRest = {
    listFilesInVault: async () => rootEntries(),
    listFilesInDir: async (dirpath: string) => dirEntries(dirpath),
    getFileContents: async (filepath: string) => {
      const c = vault.get(filepath);
      if (c === undefined) throw new Error(`Not found: ${filepath}`);
      return c;
    },
    putContent: async (filepath: string, content: string) => {
      puts.push({ filepath, content });
      vault.set(filepath, content);
    },
    findAndReplace: async (opts: unknown) => {
      // Delegate to the runFindAndReplace workhorse via dynamic import
      // so the handler's call to `rest.findAndReplace` lands here.
      const { runFindAndReplace } = await import(
        '../../../src/tools/find-and-replace/find-and-replace.js'
      );
      return runFindAndReplace(
        fakeRest as unknown as ObsidianRestService,
        opts as Parameters<typeof runFindAndReplace>[1],
        'default',
      );
    },
  };

  return { rest: fakeRest as unknown as ObsidianRestService, vault, puts };
}

function parseResultFromCallToolResult(callToolResult: unknown): Record<string, unknown> {
  // The handler returns { content: [{ type: 'text', text: '<JSON>' }] }
  const c = callToolResult as { content: Array<{ type: string; text: string }> };
  return JSON.parse(c.content[0]!.text) as Record<string, unknown>;
}

describe('find_and_replace handler (T015) — Principle II minimum', () => {
  // Happy path
  it('happy path: literal sweep with N matches in N files (FR-006)', async () => {
    const { rest } = buildFakeRest({
      'a.md': 'AcmeWidget here',
      'b.md': 'AcmeWidget twice — AcmeWidget',
      'c.md': 'AcmeWidget once',
      'unaffected.md': 'no matches',
    });
    const result = await handleFindAndReplace(
      { search: 'AcmeWidget', replacement: 'Globex' },
      rest,
      'default',
    );
    const parsed = parseResultFromCallToolResult(result);
    expect(parsed.ok).toBe(true);
    expect(parsed.filesModified).toBe(3);
    expect(parsed.totalReplacements).toBe(4);
    expect(parsed.vaultId).toBe('default');
  });

  // Failure path
  it('mid-sweep failure: records failure, sweep continues (FR-021a)', async () => {
    const { rest } = buildFakeRest({
      'a.md': 'AcmeWidget',
      'broken.md': 'AcmeWidget',
      'c.md': 'AcmeWidget',
    });
    // Inject a failing putContent for broken.md.
    const originalPut = rest.putContent.bind(rest);
    (rest as unknown as { putContent: (p: string, c: string) => Promise<void> }).putContent =
      async (filepath: string, content: string) => {
        if (filepath === 'broken.md') throw new Error('Obsidian API Error 503');
        return originalPut(filepath, content);
      };

    const result = await handleFindAndReplace(
      { search: 'AcmeWidget', replacement: 'Globex' },
      rest,
      'default',
    );
    const parsed = parseResultFromCallToolResult(result);
    expect(parsed.ok).toBe(false);
    expect(parsed.filesModified).toBe(2);
    expect(parsed.failures).toBeDefined();
    const failures = parsed.failures as Array<{ filename: string; error: string }>;
    expect(failures).toHaveLength(1);
    expect(failures[0]!.filename).toBe('broken.md');
  });
});

describe('find_and_replace handler — additional acceptance scenarios', () => {
  // Dry-run zero-write
  it('dry-run zero-write (FR-015, US1 acceptance #1)', async () => {
    const { rest, puts } = buildFakeRest({
      'a.md': 'AcmeWidget',
      'b.md': 'AcmeWidget',
    });
    const result = await handleFindAndReplace(
      { search: 'AcmeWidget', replacement: 'Globex', dryRun: true },
      rest,
      'default',
    );
    const parsed = parseResultFromCallToolResult(result);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.filesModified).toBe(2);
    expect(puts).toHaveLength(0);
  });

  // Per-file size cap on input
  it('per-file size cap > 5 MB lands in skipped (FR-024a)', async () => {
    const big = 'X'.repeat(6 * 1024 * 1024);
    const { rest } = buildFakeRest({
      'big.md': big + ' AcmeWidget',
      'small.md': 'AcmeWidget',
    });
    const result = await handleFindAndReplace(
      { search: 'AcmeWidget', replacement: 'Globex' },
      rest,
      'default',
    );
    const parsed = parseResultFromCallToolResult(result);
    expect(parsed.filesSkipped).toBe(1);
    const skipped = parsed.skipped as Array<{ filename: string; reason: string }>;
    expect(skipped[0]!.filename).toBe('big.md');
    expect(skipped[0]!.reason).toBe('size_exceeded');
  });

  // CRLF preservation
  it('CRLF preservation E2E through the handler (FR-016a)', async () => {
    const { rest, puts } = buildFakeRest({
      'crlf.md': 'Line one with AcmeWidget\r\nLine two with AcmeWidget\r\n',
    });
    await handleFindAndReplace(
      { search: 'AcmeWidget', replacement: 'Globex' },
      rest,
      'default',
    );
    expect(puts[0]!.content).toBe(
      'Line one with Globex\r\nLine two with Globex\r\n',
    );
  });

  // Multi-vault routing — covered structurally: the handler echoes
  // whatever resolvedVaultId is passed, regardless of whether it
  // matches `args.vaultId`.
  it('multi-vault routing: handler echoes resolvedVaultId in response (FR-018, US4)', async () => {
    const { rest } = buildFakeRest({ 'a.md': 'foo' });
    const result = await handleFindAndReplace(
      { search: 'foo', replacement: 'bar', vaultId: 'research' },
      rest,
      'research', // dispatcher resolved
    );
    const parsed = parseResultFromCallToolResult(result);
    expect(parsed.vaultId).toBe('research');
  });

  // Boundary validation — empty search
  it('rejects empty search at the boundary (FR-022)', async () => {
    const { rest } = buildFakeRest({ 'a.md': 'foo' });
    await expect(
      handleFindAndReplace({ search: '', replacement: 'X' }, rest, 'default'),
    ).rejects.toThrow(/search/);
  });

  // Boundary validation — uncompilable regex
  it('rejects uncompilable regex at the boundary (FR-023)', async () => {
    const { rest } = buildFakeRest({ 'a.md': 'foo' });
    await expect(
      handleFindAndReplace(
        { search: '(unclosed', replacement: 'X', regex: true },
        rest,
        'default',
      ),
    ).rejects.toThrow();
  });

  // US3 — Skip code blocks + HTML comments E2E (audit-trail preservation)
  it('US3 audit-trail E2E: skipCodeBlocks + skipHtmlComments preserve protected bytes (FR-007/8)', async () => {
    const note =
      '# AcmeWidget Notes\n\n' +
      'The AcmeWidget project ships next quarter.\n\n' +
      '```bash\n' +
      'echo "AcmeWidget"\n' +
      '```\n\n' +
      '<!-- renamed from FrobnicatorPro on 2025-12-01: AcmeWidget -->\n';
    const { rest, puts } = buildFakeRest({ 'note.md': note });
    const result = await handleFindAndReplace(
      {
        search: 'AcmeWidget',
        replacement: 'Globex',
        skipCodeBlocks: true,
        skipHtmlComments: true,
      },
      rest,
      'default',
    );
    const parsed = parseResultFromCallToolResult(result);
    expect(parsed.filesModified).toBe(1);
    // Two prose matches (heading + body line) get replaced.
    expect(parsed.totalReplacements).toBe(2);
    // The code-block AcmeWidget and the comment AcmeWidget are skipped.
    expect(parsed.totalMatchesInSkippedRegions).toBe(2);
    // Verify the actual write preserved the protected bytes.
    const written = puts[0]!.content;
    expect(written).toContain('echo "AcmeWidget"'); // code block preserved
    expect(written).toContain('<!-- renamed from FrobnicatorPro on 2025-12-01: AcmeWidget -->'); // comment preserved
    expect(written).toContain('# Globex Notes'); // heading rewritten
    expect(written).toContain('The Globex project'); // body rewritten
  });

  // US4 — Multi-vault routing
  it('US4 multi-vault routing: handler operates on the supplied rest instance, not the default (acceptance #1)', async () => {
    const defaultVault = buildFakeRest({ 'shared.md': 'AcmeWidget' });
    const researchVault = buildFakeRest({ 'shared.md': 'AcmeWidget' });

    // Caller provides the research-vault rest instance and resolvedVaultId.
    await handleFindAndReplace(
      { search: 'AcmeWidget', replacement: 'Globex', vaultId: 'research' },
      researchVault.rest,
      'research',
    );

    // The default vault MUST be untouched.
    expect(defaultVault.puts).toHaveLength(0);
    // The research vault MUST be modified.
    expect(researchVault.puts).toHaveLength(1);
    expect(researchVault.puts[0]!.content).toBe('Globex');
  });

  it('US4 — when vaultId is omitted, handler still echoes whatever resolvedVaultId the dispatcher passed (FR-018, acceptance #3)', async () => {
    const { rest } = buildFakeRest({ 'a.md': 'foo' });
    const result = await handleFindAndReplace(
      { search: 'foo', replacement: 'bar' }, // no vaultId
      rest,
      'default', // dispatcher resolved to default
    );
    const parsed = parseResultFromCallToolResult(result);
    expect(parsed.vaultId).toBe('default');
  });

  it('US3 — without skip flags, all 4 occurrences are replaced (acceptance #2)', async () => {
    const note =
      '# AcmeWidget Notes\n\n' +
      'The AcmeWidget project ships next quarter.\n\n' +
      '```bash\n' +
      'echo "AcmeWidget"\n' +
      '```\n\n' +
      '<!-- AcmeWidget -->\n';
    const { rest } = buildFakeRest({ 'note.md': note });
    const result = await handleFindAndReplace(
      { search: 'AcmeWidget', replacement: 'Globex' },
      rest,
      'default',
    );
    const parsed = parseResultFromCallToolResult(result);
    expect(parsed.totalReplacements).toBe(4);
    expect(parsed.totalMatchesInSkippedRegions).toBe(0);
  });
});
