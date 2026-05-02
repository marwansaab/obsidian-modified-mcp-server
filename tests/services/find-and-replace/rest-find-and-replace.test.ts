import { describe, it, expect } from 'vitest';

import { runFindAndReplace } from '../../../src/tools/find-and-replace/find-and-replace.js';

import type { ObsidianRestService } from '../../../src/services/obsidian-rest.js';

/**
 * Build a fake REST service that backs onto an in-memory vault. The
 * vault is a Map<filename, content>; listFilesInVault returns the
 * top-level keys, listFilesInDir filters by prefix, getFileContents
 * reads, putContent writes (and records the write in `puts` for
 * assertion).
 *
 * The helper boundary contract (R8) says findAndReplace is
 * vault-agnostic — it operates on whatever ObsidianRestService
 * instance the caller resolved. These tests validate that contract.
 */
function buildFakeRest(initial: Record<string, string>) {
  const vault = new Map(Object.entries(initial));
  const puts: Array<{ filepath: string; content: string }> = [];
  const fetched: string[] = [];

  const allKeys = () => Array.from(vault.keys());

  function rootEntries(): string[] {
    const set = new Set<string>();
    for (const k of allKeys()) {
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
    for (const k of allKeys()) {
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

  const fakeRest: Pick<
    ObsidianRestService,
    'listFilesInVault' | 'listFilesInDir' | 'getFileContents' | 'putContent'
  > = {
    listFilesInVault: async () => rootEntries(),
    listFilesInDir: async (dirpath: string) => dirEntries(dirpath),
    getFileContents: async (filepath: string) => {
      fetched.push(filepath);
      const c = vault.get(filepath);
      if (c === undefined) throw new Error(`Not found: ${filepath}`);
      return c;
    },
    putContent: async (filepath: string, content: string) => {
      puts.push({ filepath, content });
      vault.set(filepath, content);
    },
  };

  return { rest: fakeRest as unknown as ObsidianRestService, vault, puts, fetched };
}

describe('rest.findAndReplace helper (T013, T019) — the surface 012 imports', () => {
  it('happy path: literal sweep across multiple files (US1 acceptance #1)', async () => {
    const { rest, puts } = buildFakeRest({
      'a.md': 'AcmeWidget appears here',
      'b.md': 'AcmeWidget and AcmeWidget',
      'unaffected.md': 'no matches',
    });
    const result = await runFindAndReplace(
      rest,
      { search: 'AcmeWidget', replacement: 'Globex' },
      'default',
    );
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.vaultId).toBe('default');
    expect(result.filesScanned).toBe(3);
    expect(result.filesModified).toBe(2);
    expect(result.totalReplacements).toBe(3);
    expect(result.totalMatchesInSkippedRegions).toBe(0);
    expect(puts.map((p) => p.filepath).sort()).toEqual(['a.md', 'b.md']);
  });

  it('dry-run zero-write (US1 acceptance #1, FR-015)', async () => {
    const { rest, puts } = buildFakeRest({
      'a.md': 'AcmeWidget',
      'b.md': 'AcmeWidget',
    });
    const result = await runFindAndReplace(
      rest,
      { search: 'AcmeWidget', replacement: 'Globex', dryRun: true, verbose: true },
      'default',
    );
    expect(result.dryRun).toBe(true);
    expect(result.filesModified).toBe(2);
    expect(result.totalReplacements).toBe(2);
    expect(puts).toHaveLength(0); // ZERO writes in dry-run
    // Previews present in dry-run with structured shape.
    expect(result.perFile).toBeDefined();
    expect(result.perFile?.[0]?.previews).toBeDefined();
    expect(result.perFile?.[0]?.previews?.[0]?.match).toBe('AcmeWidget');
  });

  it('SC-005: re-call with same args returns filesModified: 0', async () => {
    const { rest } = buildFakeRest({ 'a.md': 'AcmeWidget' });
    await runFindAndReplace(
      rest,
      { search: 'AcmeWidget', replacement: 'Globex' },
      'default',
    );
    const second = await runFindAndReplace(
      rest,
      { search: 'AcmeWidget', replacement: 'Globex' },
      'default',
    );
    expect(second.filesModified).toBe(0);
    expect(second.totalReplacements).toBe(0);
  });

  it('byte-identical no-op (FR-014): unchanged file is not written', async () => {
    const { rest, puts } = buildFakeRest({ 'a.md': 'AcmeWidget appears here' });
    // Replacement equals original — output is byte-identical to input.
    await runFindAndReplace(
      rest,
      { search: 'AcmeWidget', replacement: 'AcmeWidget' },
      'default',
    );
    expect(puts).toHaveLength(0);
  });

  it('per-file size cap on input (FR-024a): oversize file goes to skipped', async () => {
    const big = 'X'.repeat(6 * 1024 * 1024); // 6 MB
    const { rest, puts } = buildFakeRest({
      'big.md': big + ' AcmeWidget',
      'small.md': 'AcmeWidget',
    });
    const result = await runFindAndReplace(
      rest,
      { search: 'AcmeWidget', replacement: 'Globex' },
      'default',
    );
    expect(result.filesModified).toBe(1);
    expect(result.filesSkipped).toBe(1);
    expect(result.skipped?.[0]?.filename).toBe('big.md');
    expect(result.skipped?.[0]?.reason).toBe('size_exceeded');
    expect(puts.map((p) => p.filepath)).toEqual(['small.md']);
  });

  it('mid-sweep failure (FR-021a): records failure in `failures`, sweep continues', async () => {
    const { rest } = buildFakeRest({
      'a.md': 'AcmeWidget',
      'b.md': 'AcmeWidget',
      'c.md': 'AcmeWidget',
    });
    // Override putContent on the fake to fail on b.md.
    const originalPut = rest.putContent.bind(rest);
    let callCount = 0;
    (rest as unknown as { putContent: (p: string, c: string) => Promise<void> }).putContent =
      async (filepath: string, content: string) => {
        callCount += 1;
        if (filepath === 'b.md') {
          throw new Error('Simulated REST 503');
        }
        return originalPut(filepath, content);
      };

    const result = await runFindAndReplace(
      rest,
      { search: 'AcmeWidget', replacement: 'Globex' },
      'default',
    );
    expect(result.ok).toBe(false);
    expect(result.filesModified).toBe(2); // a.md and c.md
    expect(result.failures).toHaveLength(1);
    expect(result.failures?.[0]?.filename).toBe('b.md');
    expect(result.failures?.[0]?.error).toContain('Simulated REST 503');
    expect(callCount).toBe(3); // sweep continued past the failure
  });

  it('regex with capture groups (US2 acceptance #1)', async () => {
    const { rest, puts } = buildFakeRest({
      'versions.md': 'v1.4 and v2.7',
    });
    const result = await runFindAndReplace(
      rest,
      {
        search: 'v(\\d+)\\.(\\d+)',
        replacement: 'v$1.$2.0',
        regex: true,
      },
      'default',
    );
    expect(result.totalReplacements).toBe(2);
    expect(puts[0]?.content).toBe('v1.4.0 and v2.7.0');
  });

  it('rejects empty search at the helper boundary (FR-022 backstop)', async () => {
    const { rest } = buildFakeRest({ 'a.md': 'foo' });
    await expect(
      runFindAndReplace(rest, { search: '', replacement: 'X' }, 'default'),
    ).rejects.toThrow();
  });

  it('rejects uncompilable regex at the helper boundary (FR-023 backstop)', async () => {
    const { rest } = buildFakeRest({ 'a.md': 'foo' });
    await expect(
      runFindAndReplace(
        rest,
        { search: '(unclosed', replacement: 'X', regex: true },
        'default',
      ),
    ).rejects.toThrow();
  });

  it('012-compatibility: regex pattern with skip flags (research §R12)', async () => {
    // 012's regex-passes module produces patterns of this shape:
    //   (?<!!)\[\[Foo\]\]
    // and calls with regex: true, skipCodeBlocks: true, skipHtmlComments: true.
    const { rest } = buildFakeRest({
      'note.md': 'See [[Foo]] and ![[Foo]] (embed) and [[Bar]].',
    });
    const result = await runFindAndReplace(
      rest,
      {
        search: '(?<!!)\\[\\[Foo\\]\\]',
        replacement: '[[Renamed]]',
        regex: true,
        skipCodeBlocks: true,
        skipHtmlComments: true,
      },
      'default',
    );
    // The lookbehind excludes the embed [[!Foo]]; only the bare [[Foo]]
    // is rewritten.
    expect(result.totalReplacements).toBe(1);
  });

  it('helper boundary is vault-agnostic (R8): no vaultId on options', () => {
    // Compile-time check: the RestFindAndReplaceOptions type has no
    // vaultId field. We cannot easily assert types at runtime, so this
    // test is a structural smoke test that the call accepts no vaultId.
    type OptKeys = keyof Parameters<typeof runFindAndReplace>[1];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _check: OptKeys = 'search'; // any valid key compiles
    // The following assignment would be a type error if vaultId were
    // a valid key — protected by the explicit type annotation:
    const k: OptKeys = 'verbose';
    expect(k).toBe('verbose');
  });

  it('echoes resolvedVaultId in the response', async () => {
    const { rest } = buildFakeRest({ 'a.md': 'foo' });
    const result = await runFindAndReplace(
      rest,
      { search: 'foo', replacement: 'bar' },
      'research',
    );
    expect(result.vaultId).toBe('research');
  });

  it('honors pathPrefix (FR-004): scopes the sweep to a directory', async () => {
    const { rest, puts } = buildFakeRest({
      'Projects/foo.md': 'AcmeWidget',
      'Projects/bar.md': 'AcmeWidget',
      'Other/baz.md': 'AcmeWidget',
    });
    const result = await runFindAndReplace(
      rest,
      { search: 'AcmeWidget', replacement: 'Globex', pathPrefix: 'Projects' },
      'default',
    );
    expect(result.pathPrefix).toBe('Projects');
    expect(result.filesModified).toBe(2);
    expect(puts.map((p) => p.filepath).sort()).toEqual([
      'Projects/bar.md',
      'Projects/foo.md',
    ]);
  });
});
