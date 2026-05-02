/**
 * AS-IS characterization tests for `src/tools/vault-tools.ts` (T013) and
 * the `list_files_in_vault` / `list_files_in_dir` dispatcher arms in
 * `src/index.ts` (whose tools are declared in `file-tools.ts` but
 * categorised here as "vault" listing operations per the data-model).
 *
 * `list_files_in_vault` has no required fields, so per the discipline
 * note the upstream-error path satisfies the non-happy-path requirement
 * on its own (precedent: `list_tags` in spec 008).
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
import { VAULT_TOOLS } from '../../../src/tools/vault-tools.js';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const BASE_URL = 'https://localhost:27123';

const text = (r: CallToolResult): string => (r.content?.[0] as { text: string }).text;

describe('vault-tools.ts — AS-IS characterization', () => {
  let server: ObsidianMCPServer;

  beforeEach(() => {
    server = new ObsidianMCPServer();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('VAULT_TOOLS metadata', () => {
    it('registers only `list_vaults`', () => {
      expect(VAULT_TOOLS.map((t) => t.name)).toEqual(['list_vaults']);
    });

    it('list_vaults has no required fields', () => {
      expect(VAULT_TOOLS[0].inputSchema?.required).toEqual([]);
    });
  });

  describe('list_files_in_vault dispatcher arm', () => {
    it('happy path: GETs /vault/ and JSON-stringifies the upstream files array', async () => {
      nock(BASE_URL).get('/vault/').reply(200, { files: ['a.md', 'b.md'] });
      const result = await server.handleToolCall('list_files_in_vault', {});
      expect(JSON.parse(text(result))).toEqual(['a.md', 'b.md']);
    });

    it('upstream-error path: 401 propagates with status', async () => {
      nock(BASE_URL).get('/vault/').reply(401, { errorCode: 401, message: 'unauth' });
      let captured: unknown;
      try {
        await server.handleToolCall('list_files_in_vault', {});
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('Obsidian API Error 401: unauth');
    });

    it('respects optional `vaultId` arg even when same as default', async () => {
      nock(BASE_URL).get('/vault/').reply(200, { files: [] });
      const result = await server.handleToolCall('list_files_in_vault', {
        vaultId: 'test',
      });
      expect(JSON.parse(text(result))).toEqual([]);
    });
  });

  describe('list_files_in_dir dispatcher arm', () => {
    it('happy path: GETs /vault/<dir>/ and returns JSON-stringified file list', async () => {
      nock(BASE_URL).get('/vault/Daily/').reply(200, { files: ['2026-05-02.md'] });
      const result = await server.handleToolCall('list_files_in_dir', {
        dirpath: 'Daily',
      });
      expect(JSON.parse(text(result))).toEqual(['2026-05-02.md']);
    });

    it('upstream-error path: 404 → ObsidianNotFoundError surface', async () => {
      nock(BASE_URL).get('/vault/Missing/').reply(404, { errorCode: 40400, message: 'no dir' });
      let captured: unknown;
      try {
        await server.handleToolCall('list_files_in_dir', { dirpath: 'Missing' });
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('Obsidian API Error 40400: no dir');
    });

    it('input-validation-failure: missing dirpath throws "dirpath is required"', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('list_files_in_dir', {});
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('dirpath is required');
    });
  });
});
