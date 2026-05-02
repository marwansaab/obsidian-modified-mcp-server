/**
 * AS-IS characterization tests for `src/tools/write-tools.ts` (T012).
 *
 * Tools covered (FR-009 inherited subset of WRITE_TOOLS): `append_content`,
 * `put_content`. `patch_content` lives in WRITE_TOOLS via spread but is
 * fork-authored (spec 003) and already covered by
 * `tests/tools/patch-content/*.test.ts` — NOT re-tested here per FR-009.
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
import { WRITE_TOOLS } from '../../../src/tools/write-tools.js';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const BASE_URL = 'https://localhost:27123';

const text = (r: CallToolResult): string => (r.content?.[0] as { text: string }).text;

describe('write-tools.ts — AS-IS characterization', () => {
  let server: ObsidianMCPServer;

  beforeEach(() => {
    server = new ObsidianMCPServer();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('WRITE_TOOLS metadata', () => {
    it('registers append_content and put_content (and the spread patch_content from fork-authored module)', () => {
      const names = WRITE_TOOLS.map((t) => t.name);
      expect(names.slice(0, 2)).toEqual(['append_content', 'put_content']);
      expect(names).toContain('patch_content'); // fork-authored, included here
    });

    it('append_content requires filepath and content', () => {
      const tool = WRITE_TOOLS.find((t) => t.name === 'append_content');
      expect(tool?.inputSchema?.required).toEqual(['filepath', 'content']);
    });

    it('put_content requires filepath and content', () => {
      const tool = WRITE_TOOLS.find((t) => t.name === 'put_content');
      expect(tool?.inputSchema?.required).toEqual(['filepath', 'content']);
    });
  });

  describe('append_content dispatcher arm', () => {
    it('happy path: POSTs to /vault/<file> and returns "Content appended successfully"', async () => {
      const scope = nock(BASE_URL)
        .matchHeader('Content-Type', 'text/markdown')
        .post('/vault/note.md', 'appended\n')
        .reply(200);
      const result = await server.handleToolCall('append_content', {
        filepath: 'note.md',
        content: 'appended\n',
      });
      expect(text(result)).toBe('Content appended successfully');
      expect(scope.isDone()).toBe(true);
    });

    it('upstream-error path: 500 propagates as ObsidianApiError', async () => {
      nock(BASE_URL).post('/vault/note.md').reply(500, { errorCode: 500, message: 'boom' });
      let captured: unknown;
      try {
        await server.handleToolCall('append_content', {
          filepath: 'note.md',
          content: 'x',
        });
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('Obsidian API Error 500: boom');
    });

    it('input-validation-failure: missing filepath OR content throws "filepath and content are required"', async () => {
      let captured1: unknown;
      try {
        await server.handleToolCall('append_content', { content: 'x' });
      } catch (e) {
        captured1 = e;
      }
      expect((captured1 as Error).message).toBe('filepath and content are required');

      let captured2: unknown;
      try {
        await server.handleToolCall('append_content', { filepath: 'a.md' });
      } catch (e) {
        captured2 = e;
      }
      expect((captured2 as Error).message).toBe('filepath and content are required');
    });
  });

  describe('put_content dispatcher arm', () => {
    it('happy path: PUTs to /vault/<file> and returns "Content written successfully"', async () => {
      const scope = nock(BASE_URL)
        .matchHeader('Content-Type', 'text/markdown')
        .put('/vault/note.md', 'overwritten')
        .reply(200);
      const result = await server.handleToolCall('put_content', {
        filepath: 'note.md',
        content: 'overwritten',
      });
      expect(text(result)).toBe('Content written successfully');
      expect(scope.isDone()).toBe(true);
    });

    it('upstream-error path: 403 propagates with status', async () => {
      nock(BASE_URL).put('/vault/note.md').reply(403, { errorCode: 403, message: 'forbidden' });
      let captured: unknown;
      try {
        await server.handleToolCall('put_content', {
          filepath: 'note.md',
          content: 'x',
        });
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('Obsidian API Error 403: forbidden');
    });

    it('input-validation-failure: missing both throws', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('put_content', {});
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('filepath and content are required');
    });
  });
});
