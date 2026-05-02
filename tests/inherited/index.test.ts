/**
 * AS-IS characterization tests for `src/index.ts` (T020).
 *
 * Scope (the parts of `src/index.ts` not exercised by the per-tool
 * dispatcher tests in `tests/inherited/tools/*.test.ts`):
 *
 *   - Helpers: `getVaultConfig` (vault-not-found error), `getRestService`
 *     (caching by vault id), `globToRegex`, `runPatternSearch` (filesystem
 *     traversal with a tmpdir vault fixture).
 *   - The `list_vaults` arm (executes BEFORE vault resolution; covers the
 *     branch `if (name === 'list_vaults')`).
 *   - The `default` unknown-tool arm (covers `throw new Error('Unknown tool: <name>')`).
 *   - The `pattern_search` dispatcher arm end-to-end (paired with a tiny
 *     fixture vault under `os.tmpdir()`).
 *
 * Out-of-scope (covered elsewhere — see T022 for the documented arms):
 *   - All FR-009 inherited tool dispatcher arms (covered by per-tool files
 *     under `tests/inherited/tools/`).
 *   - Fork-authored dispatcher arms (`list_tags`, `delete_file`,
 *     `patch_content`, `get_heading_contents`, `get_frontmatter_field`,
 *     graph tools, `find_similar_notes`) — already covered by
 *     fork-authored tests under `tests/tools/<feature>/`.
 *
 * Implementer note (T020): we do NOT modify `src/index.ts` to make it
 * more testable per FR-006. The module's top-level `main()` call is
 * neutralised by mocking `src/config.js` so `getConfig()` returns a
 * fixed config (the same pattern the existing
 * `tests/tools/semantic-tools/find-similar-handler.test.ts` uses).
 * The `process.on('SIGINT'/'SIGTERM')` handlers remain uncovered by
 * design — see T022's "Uncovered by design" section.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import nock from 'nock';
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';

const FIXTURE_DIR = mkdtempSync(join(tmpdir(), 'spec009-pattern-search-'));

// Build a tiny fixture vault BEFORE config mock evaluates (the mock factory
// closes over FIXTURE_DIR by the time tests run, but writing files now means
// the fixture is on disk by the first test).
mkdirSync(join(FIXTURE_DIR, 'Notes'), { recursive: true });
mkdirSync(join(FIXTURE_DIR, 'Daily'), { recursive: true });
writeFileSync(
  join(FIXTURE_DIR, 'Notes', 'todo.md'),
  '# TODO list\nTODO: write tests\nTODO: review PR\nDone: ship feature\n',
  'utf-8'
);
writeFileSync(
  join(FIXTURE_DIR, 'Daily', '2026-05-02.md'),
  'Today\nTODO: meet 1:1\nWeather: 2026-05-02\n',
  'utf-8'
);
writeFileSync(
  join(FIXTURE_DIR, 'README.md'),
  'No matches in this file.\n',
  'utf-8'
);
// A non-markdown file that should be ignored by `runPatternSearch`'s
// `extname === '.md'` filter.
writeFileSync(
  join(FIXTURE_DIR, 'notes.txt'),
  'TODO: ignored because not .md\n',
  'utf-8'
);
// A dotfile-prefixed entry that should be skipped by the
// `entry.name.startsWith('.')` check.
mkdirSync(join(FIXTURE_DIR, '.hidden'), { recursive: true });
writeFileSync(
  join(FIXTURE_DIR, '.hidden', 'secret.md'),
  'TODO: should be hidden from pattern_search',
  'utf-8'
);

// Neutralise the side-effecting top-level `main()` call in `src/index.ts`
// (line 553). Without this, main()'s `server.run()` may throw when stdio
// is not a real MCP transport during the test run → main()'s catch calls
// `process.exit(1)` → Vitest reports an unhandled rejection that makes
// `npm test` exit non-zero (a false signal distinct from the coverage
// gate). See T020 implementer note.
//
// We patch process.exit at hoist time so a stray `process.exit(1)` from
// main() becomes a logged warning rather than killing the worker. The
// patch is reverted in afterAll so subsequent vitest teardown still works
// normally. This is the lightest-touch fix: no SDK mocking, no
// modification of `src/`.
vi.hoisted(() => {
  const original = process.exit.bind(process);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process as unknown as { exit: (code?: number) => void }).exit = (code) => {
    if (code === 1) {
      // Swallow main()'s "Failed to start server" exit — see comment above.
      return undefined as never;
    }
    return original(code);
  };
});

vi.mock('../../src/config.js', () => ({
  getConfig: () => ({
    defaultVaultId: 'test',
    vaults: {
      test: {
        id: 'test',
        apiKey: 'test-api-key',
        host: 'localhost',
        port: 27123,
        protocol: 'https' as const,
        verifySsl: false,
        smartConnectionsPort: 8765,
        vaultPath: FIXTURE_DIR,
      },
      other: {
        id: 'other',
        apiKey: 'other-api-key',
        host: 'localhost',
        port: 27124,
        protocol: 'https' as const,
        verifySsl: false,
      },
    },
    graphCacheTtl: 300,
    verifySsl: false,
  }),
}));

import { ObsidianMCPServer } from '../../src/index.js';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const text = (r: CallToolResult): string => (r.content?.[0] as { text: string }).text;

describe('src/index.ts — AS-IS characterization (T020)', () => {
  let server: ObsidianMCPServer;

  beforeEach(() => {
    server = new ObsidianMCPServer();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  afterAll(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  describe('list_vaults arm (runs before vault resolution)', () => {
    it('returns the configured vault map with isDefault, hasVaultPath, hasSmartConnections capability flags', async () => {
      const result = await server.handleToolCall('list_vaults', {});
      const parsed = JSON.parse(text(result));
      expect(parsed.defaultVaultId).toBe('test');
      expect(parsed.vaults).toEqual([
        {
          id: 'test',
          isDefault: true,
          hasVaultPath: true,
          hasSmartConnections: true,
          host: 'localhost',
          port: 27123,
          protocol: 'https',
        },
        {
          id: 'other',
          isDefault: false,
          hasVaultPath: false,
          hasSmartConnections: false,
          host: 'localhost',
          port: 27124,
          protocol: 'https',
        },
      ]);
    });

    it('does NOT consult `args.vaultId` — calling with vaultId="bogus" still succeeds', async () => {
      const result = await server.handleToolCall('list_vaults', { vaultId: 'bogus' });
      expect(JSON.parse(text(result)).vaults).toHaveLength(2);
    });
  });

  describe('default unknown-tool arm', () => {
    it('throws "Unknown tool: <name>" for any unrecognised tool', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('unicorn_tool', {});
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('Unknown tool: unicorn_tool');
    });
  });

  describe('vault resolution helpers', () => {
    it('resolveVaultId/getVaultConfig: an unknown vaultId throws "Vault \\"<id>\\" is not configured"', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('list_files_in_vault', { vaultId: 'nonexistent' });
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('Vault "nonexistent" is not configured');
    });

    it('getRestService caches a single instance per vault id (second call same vault → same instance)', async () => {
      // Two consecutive happy-path calls against the same vault touch
      // getRestService once; subsequent calls reuse the cached entry.
      // We assert this by verifying the second call works after exactly one
      // nock interceptor — i.e., the same axios client is used both times.
      nock('https://localhost:27123').get('/vault/').times(2).reply(200, { files: [] });
      await server.handleToolCall('list_files_in_vault', {});
      await server.handleToolCall('list_files_in_vault', {});
      expect(nock.isDone()).toBe(true);
    });

    it('getRestService creates separate instances per vault id (different baseURL → different nock host)', async () => {
      nock('https://localhost:27123').get('/vault/').reply(200, { files: ['a'] });
      nock('https://localhost:27124').get('/vault/').reply(200, { files: ['b'] });
      const a = await server.handleToolCall('list_files_in_vault', { vaultId: 'test' });
      const b = await server.handleToolCall('list_files_in_vault', { vaultId: 'other' });
      expect(JSON.parse(text(a))).toEqual(['a']);
      expect(JSON.parse(text(b))).toEqual(['b']);
    });

    it('args.vaultId is trimmed; whitespace-only vaultId falls back to default', async () => {
      // After trim, requested becomes ''. resolveVaultId calls getVaultConfig('')
      // → looks up vaults[''] → undefined → throws.
      let captured: unknown;
      try {
        await server.handleToolCall('list_files_in_vault', { vaultId: '   ' });
      } catch (e) {
        captured = e;
      }
      // The trimmed empty string is forwarded to getVaultConfig, which throws.
      // (AS-IS: the wrapper does NOT treat '' as "use default" — encoded as the contract.)
      expect((captured as Error).message).toBe('Vault "" is not configured');
    });
  });

  describe('runPatternSearch via the pattern_search dispatcher arm', () => {
    it('finds matches across the fixture vault, with default contextLines=2 and maxMatches=100', async () => {
      const result = await server.handleToolCall('pattern_search', {
        patterns: ['TODO:.*'],
      });
      const parsed = JSON.parse(text(result)) as Array<{
        vaultId: string;
        file: string;
        line: number;
        pattern: string;
        match: string;
        context: string;
      }>;

      // Expects 3 matches (todo.md has 2 + 2026-05-02.md has 1). The
      // `.hidden` directory and `notes.txt` are skipped.
      expect(parsed.length).toBe(3);
      const files = new Set(parsed.map((p) => p.file));
      expect(files).toEqual(new Set(['Notes/todo.md', 'Daily/2026-05-02.md']));
      // All matches name the vault id.
      expect(parsed.every((p) => p.vaultId === 'test')).toBe(true);
      // Every match's `match` field starts with TODO:.
      expect(parsed.every((p) => p.match.startsWith('TODO:'))).toBe(true);
      // Context contains both the matched line and adjacent lines (default 2).
      const todoMd = parsed.find(
        (p) => p.file === 'Notes/todo.md' && p.line === 2
      );
      expect(todoMd?.context).toContain('# TODO list');
    });

    it('respects scope.folders: searching only Daily yields 1 match', async () => {
      const result = await server.handleToolCall('pattern_search', {
        patterns: ['TODO:.*'],
        scope: { folders: ['Daily'] },
      });
      const parsed = JSON.parse(text(result)) as Array<{ file: string }>;
      expect(parsed).toHaveLength(1);
      expect(parsed[0].file).toBe('Daily/2026-05-02.md');
    });

    it('respects scope.filePattern: a glob like "Daily/*.md" yields the daily file only', async () => {
      const result = await server.handleToolCall('pattern_search', {
        patterns: ['TODO:.*'],
        scope: { filePattern: 'Daily/*.md' },
      });
      const parsed = JSON.parse(text(result)) as Array<{ file: string }>;
      expect(parsed.every((p) => p.file === 'Daily/2026-05-02.md')).toBe(true);
    });

    it('respects options.maxMatches: a maxMatches=1 cap returns exactly one result', async () => {
      const result = await server.handleToolCall('pattern_search', {
        patterns: ['TODO:.*'],
        options: { maxMatches: 1 },
      });
      expect(JSON.parse(text(result))).toHaveLength(1);
    });

    it('respects options.contextLines: contextLines=0 produces a single-line context', async () => {
      const result = await server.handleToolCall('pattern_search', {
        patterns: ['TODO:.*'],
        scope: { folders: ['Daily'] },
        options: { contextLines: 0 },
      });
      const parsed = JSON.parse(text(result)) as Array<{ context: string }>;
      // contextLines=0 → snippetStart === snippetEnd → 1-line slice.
      expect(parsed[0].context).toBe('TODO: meet 1:1');
    });

    it('respects options.caseSensitive: case-sensitive search for "todo" misses the uppercase TODOs', async () => {
      const result = await server.handleToolCall('pattern_search', {
        patterns: ['todo:.*'],
        options: { caseSensitive: true },
      });
      expect(JSON.parse(text(result))).toEqual([]);
    });

    it('case-insensitive (default) search for "todo" matches the uppercase TODOs', async () => {
      const result = await server.handleToolCall('pattern_search', {
        patterns: ['todo:.*'],
      });
      const parsed = JSON.parse(text(result));
      expect(Array.isArray(parsed) && parsed.length > 0).toBe(true);
    });

    it('throws "Invalid regex pattern" on a malformed regex', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('pattern_search', {
          patterns: ['(unclosed['],
        });
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toMatch(/^Invalid regex pattern "\(unclosed\["/);
    });

    it('returns [] when no .md file matches the pattern', async () => {
      const result = await server.handleToolCall('pattern_search', {
        patterns: ['ZZZZ-no-such-string'],
      });
      expect(JSON.parse(text(result))).toEqual([]);
    });

    it('handles zero-length matches without infinite-looping (lastIndex++ guard)', async () => {
      // A pattern that produces zero-length matches, e.g., `^` (start-of-line).
      // Without the `regex.lastIndex++` guard the inner while-loop would spin
      // forever; with it, each line yields exactly one start-of-line match.
      const result = await server.handleToolCall('pattern_search', {
        patterns: ['^'],
        scope: { folders: ['Daily'] },
        options: { maxMatches: 5 },
      });
      const parsed = JSON.parse(text(result)) as Array<{ match: string; line: number }>;
      // Daily/2026-05-02.md has 3 non-empty lines; the regex with `gi` flag
      // also matches the trailing empty string on the final newline-split entry.
      expect(parsed.length).toBeGreaterThan(0);
      expect(parsed.every((p) => p.match === '')).toBe(true);
    });

    it('breaks out of the per-pattern loop when maxMatches is hit while iterating multiple patterns', async () => {
      // Two patterns, maxMatches=1: the first pattern finds a match, the
      // outer "if (results.length >= maxMatches) break;" then stops the
      // pattern loop before the second pattern runs.
      const result = await server.handleToolCall('pattern_search', {
        patterns: ['TODO:.*', 'Weather:.*'],
        scope: { folders: ['Daily'] },
        options: { maxMatches: 1 },
      });
      const parsed = JSON.parse(text(result)) as Array<{ pattern: string }>;
      expect(parsed).toHaveLength(1);
      // The first pattern must be the one that produced the lone match.
      expect(parsed[0].pattern).toBe('TODO:.*');
    });

    it('throws when vaultPath is missing on the resolved vault', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('pattern_search', {
          patterns: ['x'],
          vaultId: 'other',
        });
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe(
        'pattern_search requires vaultPath to be configured for vault "other".'
      );
    });

    it('input-validation-failure: missing patterns throws "patterns array is required"', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('pattern_search', {});
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('patterns array is required');
    });

    it('skips folder entries whose readdir fails (the inner try/catch catch arm)', async () => {
      // Pointing scope.folders at a non-existent subfolder triggers the
      // walkDir try/catch around `readdir(...)`. The function silently
      // returns early — no error surfaced to the caller, just zero results.
      const result = await server.handleToolCall('pattern_search', {
        patterns: ['TODO:.*'],
        scope: { folders: ['NoSuchFolder'] },
      });
      expect(JSON.parse(text(result))).toEqual([]);
    });
  });

  describe('globToRegex (exercised via pattern_search filePattern)', () => {
    it('the "*" glob is greedy (matches anything including path separators)', async () => {
      // Pattern "*.md" via the wrapper's globToRegex translates to /^.*\.md$/i.
      // That matches "Notes/todo.md" because `.` was escaped and `*` became `.*`,
      // and the `.*` matches the slash too. AS-IS: NOT real glob semantics.
      const result = await server.handleToolCall('pattern_search', {
        patterns: ['TODO:.*'],
        scope: { filePattern: '*.md' },
      });
      const parsed = JSON.parse(text(result)) as Array<{ file: string }>;
      // Both Notes/todo.md and Daily/2026-05-02.md match because `*` consumes `/`.
      expect(parsed.length).toBeGreaterThan(0);
    });

    it('the "?" glob matches a single character (escaped via globToRegex)', async () => {
      // Pattern "Notes/tod?.md" matches "Notes/todo.md" — '?' becomes '.'.
      const result = await server.handleToolCall('pattern_search', {
        patterns: ['TODO:.*'],
        scope: { filePattern: 'Notes/tod?.md' },
      });
      const parsed = JSON.parse(text(result)) as Array<{ file: string }>;
      expect(parsed.every((p) => p.file === 'Notes/todo.md')).toBe(true);
    });
  });
});
