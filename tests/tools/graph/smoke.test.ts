import * as fs from 'node:fs';
import { afterAll, describe, expect, it, vi } from 'vitest';

const { TMP_DIR } = vi.hoisted(() => {
  // The mock factory below is hoisted above all imports, so we must
  // synchronously create the tmp dir during the same hoisted phase.
  // ESM cannot synchronously import here, so use createRequire.
  /* eslint-disable @typescript-eslint/no-require-imports */
  const fsLocal = require('node:fs') as typeof import('node:fs');
  const pathLocal = require('node:path') as typeof import('node:path');
  const osLocal = require('node:os') as typeof import('node:os');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return {
    TMP_DIR: fsLocal.mkdtempSync(pathLocal.join(osLocal.tmpdir(), 'graph-smoke-')),
  };
});

vi.mock('../../../src/config.js', () => ({
  getConfig: () => ({
    defaultVaultId: 'test',
    vaults: {
      test: {
        id: 'test',
        apiKey: 'unused',
        host: 'localhost',
        port: 27123,
        protocol: 'http' as const,
        vaultPath: TMP_DIR,
        verifySsl: false,
      },
    },
    graphCacheTtl: 300,
    verifySsl: false,
  }),
}));

afterAll(() => fs.rmSync(TMP_DIR, { recursive: true, force: true }));

import { ObsidianMCPServer } from '../../../src/index.js';

type SmokeRow =
  | {
      name: string;
      args: Record<string, unknown>;
      kind: 'aggregation';
      primaryKey: 'tree' | 'orphans' | 'notes' | 'clusters';
      primaryType: 'object' | 'array';
    }
  | {
      name: string;
      args: Record<string, unknown>;
      kind: 'per-note';
    };

const ROWS: SmokeRow[] = [
  {
    name: 'get_vault_structure',
    args: {},
    kind: 'aggregation',
    primaryKey: 'tree',
    primaryType: 'object',
  },
  {
    name: 'find_orphan_notes',
    args: {},
    kind: 'aggregation',
    primaryKey: 'orphans',
    primaryType: 'array',
  },
  {
    name: 'get_most_connected_notes',
    args: {},
    kind: 'aggregation',
    primaryKey: 'notes',
    primaryType: 'array',
  },
  {
    name: 'detect_note_clusters',
    args: {},
    kind: 'aggregation',
    primaryKey: 'clusters',
    primaryType: 'array',
  },
  {
    name: 'get_note_connections',
    args: { filepath: 'smoke-test-nonexistent.md' },
    kind: 'per-note',
  },
  {
    name: 'find_path_between_notes',
    args: { source: 'a.md', target: 'b.md' },
    kind: 'per-note',
  },
];

describe.each(ROWS)('graph dispatch routing — $name (FR-013)', (row) => {
  it('routes to a handler (no "Unknown tool" error)', async () => {
    const server = new ObsidianMCPServer();

    if (row.kind === 'aggregation') {
      const result = await server.handleToolCall(row.name, row.args);
      const text = (result.content[0] as { text: string }).text;
      expect(text).not.toContain('Unknown tool');

      const parsed = JSON.parse(text) as Record<string, unknown>;
      expect(parsed).toHaveProperty(row.primaryKey);
      if (row.primaryType === 'array') {
        expect(Array.isArray(parsed[row.primaryKey])).toBe(true);
      } else {
        expect(typeof parsed[row.primaryKey]).toBe('object');
        expect(parsed[row.primaryKey]).not.toBeNull();
      }
      expect(typeof parsed.skipped).toBe('number');
      expect(Array.isArray(parsed.skippedPaths)).toBe(true);
    } else {
      let captured: unknown;
      try {
        await server.handleToolCall(row.name, row.args);
        throw new Error('expected per-note tool to throw with not-found error');
      } catch (err) {
        captured = err;
      }
      expect(captured).toBeInstanceOf(Error);
      const message = (captured as Error).message;
      expect(message).not.toContain('Unknown tool');
      expect(message).toMatch(/^notes? not found:/);
    }
  });
});
