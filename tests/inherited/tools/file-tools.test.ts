/**
 * AS-IS characterization tests for `src/tools/file-tools.ts` (T010).
 *
 * Tools covered (FR-009): `get_file_contents`, `batch_get_file_contents`.
 * `list_files_in_vault` and `list_files_in_dir` are also defined in
 * `file-tools.ts` but are tested in `vault-tools.test.ts` (T013) where
 * they are categorised by the data-model — keeping the tests co-located
 * with the source file's `Tool[]` export keeps test-to-source navigation
 * mechanical.
 *
 * Tests instantiate `ObsidianMCPServer`, mock the upstream REST endpoints
 * with `nock`, and call `handleToolCall(name, args)` directly. The
 * dispatcher arm wraps the `ObsidianRestService` method's return value
 * in `{ content: [{ type: 'text', text: ... }] }` form; we assert both
 * the request shape and the wrapped output.
 *
 * Source-file-level metadata sanity checks (registration, required-fields)
 * also live in this file rather than in a separate registration test —
 * this file is the single test surface for `file-tools.ts`.
 */

import nock from 'nock';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/config.js', () => ({
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
      },
    },
    graphCacheTtl: 300,
    verifySsl: false,
  }),
}));

import { ObsidianMCPServer } from '../../../src/index.js';
import { FILE_TOOLS } from '../../../src/tools/file-tools.js';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const BASE_URL = 'https://localhost:27123';

const text = (r: CallToolResult): string =>
  (r.content?.[0] as { text: string }).text;

describe('file-tools.ts — AS-IS characterization', () => {
  let server: ObsidianMCPServer;

  beforeEach(() => {
    server = new ObsidianMCPServer();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('FILE_TOOLS metadata', () => {
    it('registers exactly the four upstream-inherited file tools in declared order', () => {
      expect(FILE_TOOLS.map((t) => t.name)).toEqual([
        'list_files_in_vault',
        'list_files_in_dir',
        'get_file_contents',
        'batch_get_file_contents',
      ]);
    });

    it('list_files_in_vault has no required fields (vaultId is optional)', () => {
      const tool = FILE_TOOLS.find((t) => t.name === 'list_files_in_vault');
      expect(tool?.inputSchema?.required).toEqual([]);
    });

    it('get_file_contents requires `filepath`', () => {
      const tool = FILE_TOOLS.find((t) => t.name === 'get_file_contents');
      expect(tool?.inputSchema?.required).toEqual(['filepath']);
    });

    it('batch_get_file_contents requires `filepaths`', () => {
      const tool = FILE_TOOLS.find((t) => t.name === 'batch_get_file_contents');
      expect(tool?.inputSchema?.required).toEqual(['filepaths']);
    });
  });

  describe('get_file_contents dispatcher arm', () => {
    it('happy path: returns the upstream body as the single text content block', async () => {
      const body = '# Hello\n\nWorld';
      nock(BASE_URL).get('/vault/note.md').reply(200, body);
      const result = await server.handleToolCall('get_file_contents', {
        filepath: 'note.md',
      });
      expect(text(result)).toBe(body);
      expect(result.isError).toBeFalsy();
    });

    it('upstream-error path: 404 propagates as ObsidianNotFoundError', async () => {
      nock(BASE_URL).get('/vault/missing.md').reply(404);
      let captured: unknown;
      try {
        await server.handleToolCall('get_file_contents', { filepath: 'missing.md' });
      } catch (e) {
        captured = e;
      }
      expect(captured).toBeInstanceOf(Error);
      expect((captured as Error).message).toContain('Obsidian API Error 404');
    });

    it('input-validation-failure: missing filepath throws "filepath is required"', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('get_file_contents', {});
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('filepath is required');
    });

    it('input-validation-failure: empty filepath throws "filepath is required" (truthy check)', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('get_file_contents', { filepath: '' });
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('filepath is required');
    });
  });

  describe('batch_get_file_contents dispatcher arm', () => {
    it('happy path: concatenates upstream bodies with header + separator', async () => {
      nock(BASE_URL).get('/vault/a.md').reply(200, 'A');
      nock(BASE_URL).get('/vault/b.md').reply(200, 'B');
      const result = await server.handleToolCall('batch_get_file_contents', {
        filepaths: ['a.md', 'b.md'],
      });
      expect(text(result)).toBe('# a.md\n\nA\n\n---\n\n# b.md\n\nB\n\n---\n\n');
    });

    it('partial-error path: per-file 404 becomes inline "Error reading file: ..." (no throw)', async () => {
      nock(BASE_URL).get('/vault/a.md').reply(200, 'A');
      nock(BASE_URL).get('/vault/missing.md').reply(404);
      const result = await server.handleToolCall('batch_get_file_contents', {
        filepaths: ['a.md', 'missing.md'],
      });
      expect(text(result)).toContain('# a.md\n\nA\n\n---\n\n');
      expect(text(result)).toContain('# missing.md\n\nError reading file:');
      expect(result.isError).toBeFalsy();
    });

    it('input-validation-failure: missing filepaths throws "filepaths array is required"', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('batch_get_file_contents', {});
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('filepaths array is required');
    });

    it('input-validation-failure: non-array filepaths throws "filepaths array is required"', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('batch_get_file_contents', { filepaths: 'note.md' });
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('filepaths array is required');
    });
  });
});
