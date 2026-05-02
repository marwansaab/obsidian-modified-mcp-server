import { describe, it, expect } from 'vitest';

import { walkVault, __testing } from '../../../src/tools/find-and-replace/walker.js';

import type { ObsidianRestService } from '../../../src/services/obsidian-rest.js';

/**
 * Build a mocked ObsidianRestService that returns prepared file lists
 * for given directories. Pretends to support listFilesInVault (root)
 * and listFilesInDir (subdir).
 *
 * The shape of `tree` is: keys are vault-relative directories ('' for
 * root). Values are arrays mixing `name.md` (file) and `name/` (dir).
 */
function buildMockRest(tree: Record<string, string[]>): ObsidianRestService {
  return {
    listFilesInVault: async () => tree[''] ?? [],
    listFilesInDir: async (dirpath: string) => tree[dirpath] ?? [],
  } as unknown as ObsidianRestService;
}

describe('walker (T007/T008)', () => {
  it('returns vault-root .md files in lex-ascending order', async () => {
    const rest = buildMockRest({
      '': ['Zebra.md', 'Apple.md', 'Mango.md'],
    });
    const files = await walkVault(rest);
    expect(files).toEqual(['Apple.md', 'Mango.md', 'Zebra.md']);
  });

  it('recurses into subdirectories', async () => {
    const rest = buildMockRest({
      '': ['Projects/', 'README.md'],
      Projects: ['notes.md', 'Subdir/'],
      'Projects/Subdir': ['deep.md'],
    });
    const files = await walkVault(rest);
    expect(files).toEqual([
      'Projects/Subdir/deep.md',
      'Projects/notes.md',
      'README.md',
    ]);
  });

  it('excludes dot-prefixed directories at root and inside subdirs (FR-024b)', async () => {
    const rest = buildMockRest({
      '': ['.obsidian/', 'Projects/', 'README.md'],
      '.obsidian': ['plugin.md'], // should never be enumerated
      Projects: ['.hidden/', 'public.md'],
      'Projects/.hidden': ['secret.md'], // should never be enumerated
    });
    const files = await walkVault(rest);
    expect(files).toEqual(['Projects/public.md', 'README.md']);
  });

  it('excludes dot-prefixed FILES at any level (FR-024b)', async () => {
    const rest = buildMockRest({
      '': ['.config.md', 'README.md', 'Sub/'],
      Sub: ['.also-hidden.md', 'visible.md'],
    });
    const files = await walkVault(rest);
    expect(files).toEqual(['README.md', 'Sub/visible.md']);
  });

  it('matches the .md extension case-insensitively (FR-024)', async () => {
    const rest = buildMockRest({
      '': ['Foo.md', 'Bar.MD', 'Baz.Md', 'Qux.mD', 'NotAnNote.txt'],
    });
    const files = await walkVault(rest);
    expect(files).toEqual(['Bar.MD', 'Baz.Md', 'Foo.md', 'Qux.mD']);
  });

  it('honors pathPrefix as a directory-segment prefix (FR-004)', async () => {
    const rest = buildMockRest({
      '': ['Projects/', 'Projects.md', 'Other.md'],
      Projects: ['inside.md'],
    });
    const files = await walkVault(rest, 'Projects');
    // 'Projects.md' should NOT match — segment match excludes it.
    expect(files).toEqual(['Projects/inside.md']);
  });

  it('normalizes a trailing slash in pathPrefix (FR-004)', async () => {
    const rest = buildMockRest({
      '': ['Projects/'],
      Projects: ['a.md', 'b.md'],
    });
    const filesNoSlash = await walkVault(rest, 'Projects');
    const filesWithSlash = await walkVault(rest, 'Projects/');
    expect(filesNoSlash).toEqual(filesWithSlash);
  });

  it('pathPrefix matching is case-sensitive on all platforms (FR-004)', async () => {
    const rest = buildMockRest({
      '': ['Projects/'],
      Projects: ['notes.md'],
    });
    // Lowercase prefix MUST NOT match the capitalized directory.
    const lower = await walkVault(rest, 'projects');
    expect(lower).toEqual([]);
  });

  it('does NOT support glob patterns in pathPrefix (FR-004)', async () => {
    const rest = buildMockRest({
      '': ['Projects/'],
      Projects: ['notes.md'],
    });
    // A glob-like prefix is treated as a literal — no files should match.
    const globlike = await walkVault(rest, 'Projects/**');
    expect(globlike).toEqual([]);
  });

  it('returns forward-slash paths with no leading slash (R11)', async () => {
    const rest = buildMockRest({
      '': ['Sub/'],
      Sub: ['file.md'],
    });
    const files = await walkVault(rest);
    expect(files[0]).toBe('Sub/file.md');
    expect(files[0]?.startsWith('/')).toBe(false);
    expect(files[0]?.includes('\\')).toBe(false);
  });

  it('handles an empty vault gracefully', async () => {
    const rest = buildMockRest({ '': [] });
    expect(await walkVault(rest)).toEqual([]);
  });
});

describe('walker internals (whitebox)', () => {
  it('hasDotPrefixedSegment recognizes nested dot dirs', () => {
    expect(__testing.hasDotPrefixedSegment('a/b/.hidden/file.md')).toBe(true);
    expect(__testing.hasDotPrefixedSegment('.obsidian/foo.md')).toBe(true);
    expect(__testing.hasDotPrefixedSegment('Projects/notes.md')).toBe(false);
  });

  it('matchesPathPrefix handles segment vs literal-prefix correctly', () => {
    expect(__testing.matchesPathPrefix('Projects/notes.md', 'Projects')).toBe(true);
    expect(__testing.matchesPathPrefix('Projects.md', 'Projects')).toBe(false); // segment match!
    expect(__testing.matchesPathPrefix('Projects', 'Projects')).toBe(true); // exact equality
    expect(__testing.matchesPathPrefix('any/path.md', '')).toBe(true); // empty prefix matches all
  });

  it('isDirectoryEntry distinguishes by trailing slash', () => {
    expect(__testing.isDirectoryEntry('Projects/')).toBe(true);
    expect(__testing.isDirectoryEntry('notes.md')).toBe(false);
  });
});
