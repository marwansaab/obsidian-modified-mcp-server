/**
 * AS-IS characterization tests for `src/tools/obsidian-tools.ts` (T016).
 *
 * Tools: `get_active_file`, `open_file`, `list_commands`, `execute_command`.
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
import { OBSIDIAN_TOOLS } from '../../../src/tools/obsidian-tools.js';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const BASE_URL = 'https://localhost:27123';

const text = (r: CallToolResult): string => (r.content?.[0] as { text: string }).text;

describe('obsidian-tools.ts — AS-IS characterization', () => {
  let server: ObsidianMCPServer;

  beforeEach(() => {
    server = new ObsidianMCPServer();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('OBSIDIAN_TOOLS metadata', () => {
    it('registers the four Obsidian-integration tools in declared order', () => {
      expect(OBSIDIAN_TOOLS.map((t) => t.name)).toEqual([
        'get_active_file',
        'open_file',
        'list_commands',
        'execute_command',
      ]);
    });

    it('open_file requires `filepath`', () => {
      expect(
        OBSIDIAN_TOOLS.find((t) => t.name === 'open_file')?.inputSchema?.required
      ).toEqual(['filepath']);
    });

    it('execute_command requires `commands`', () => {
      expect(
        OBSIDIAN_TOOLS.find((t) => t.name === 'execute_command')?.inputSchema?.required
      ).toEqual(['commands']);
    });
  });

  describe('get_active_file dispatcher arm', () => {
    it('happy path: GETs /active/ with Accept: text/markdown and returns body', async () => {
      nock(BASE_URL)
        .matchHeader('Accept', 'text/markdown')
        .get('/active/')
        .reply(200, '# Active Note');
      const result = await server.handleToolCall('get_active_file', {});
      expect(text(result)).toBe('# Active Note');
    });

    it('upstream-error path: 404 (no active file) propagates as ObsidianNotFoundError', async () => {
      nock(BASE_URL).get('/active/').reply(404);
      let captured: unknown;
      try {
        await server.handleToolCall('get_active_file', {});
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toContain('Obsidian API Error 404');
    });
  });

  describe('open_file dispatcher arm', () => {
    it('happy path: POSTs /open/?file=<path> and returns "File opened successfully"', async () => {
      const scope = nock(BASE_URL)
        .post('/open/')
        .query({ file: 'note.md' })
        .reply(200);
      const result = await server.handleToolCall('open_file', { filepath: 'note.md' });
      expect(text(result)).toBe('File opened successfully');
      expect(scope.isDone()).toBe(true);
    });

    it('upstream-error path: 404 propagates', async () => {
      nock(BASE_URL).post('/open/').query(true).reply(404);
      let captured: unknown;
      try {
        await server.handleToolCall('open_file', { filepath: 'missing.md' });
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toContain('Obsidian API Error 404');
    });

    it('input-validation-failure: missing filepath throws "filepath is required"', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('open_file', {});
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('filepath is required');
    });
  });

  describe('list_commands dispatcher arm', () => {
    it('happy path: GETs /commands/ and returns JSON-stringified body', async () => {
      const upstream = [{ id: 'editor:save', name: 'Save' }];
      nock(BASE_URL).get('/commands/').reply(200, upstream);
      const result = await server.handleToolCall('list_commands', {});
      expect(JSON.parse(text(result))).toEqual(upstream);
    });

    it('upstream-error path: 500 propagates', async () => {
      nock(BASE_URL).get('/commands/').reply(500, { errorCode: 500, message: 'boom' });
      let captured: unknown;
      try {
        await server.handleToolCall('list_commands', {});
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('Obsidian API Error 500: boom');
    });
  });

  describe('execute_command dispatcher arm', () => {
    it('happy path single command: POSTs to /commands/<id> and returns "✓ <id>"', async () => {
      nock(BASE_URL).post('/commands/editor%3Asave').reply(200);
      const result = await server.handleToolCall('execute_command', {
        commands: ['editor:save'],
      });
      expect(text(result)).toBe('✓ editor:save');
    });

    it('happy path multiple commands: each POSTs in order, joined by newlines', async () => {
      nock(BASE_URL).post('/commands/editor%3Asave').reply(200);
      nock(BASE_URL).post('/commands/editor%3Aselect-all').reply(200);
      const result = await server.handleToolCall('execute_command', {
        commands: ['editor:save', 'editor:select-all'],
      });
      expect(text(result)).toBe('✓ editor:save\n✓ editor:select-all');
    });

    it('partial-failure path: failing command becomes "✗ <id>: <message>" while subsequent commands continue', async () => {
      nock(BASE_URL)
        .post('/commands/bad')
        .reply(404, { errorCode: 40400, message: 'no such command' });
      nock(BASE_URL).post('/commands/editor%3Asave').reply(200);
      const result = await server.handleToolCall('execute_command', {
        commands: ['bad', 'editor:save'],
      });
      const out = text(result);
      expect(out).toContain('✗ bad: Obsidian API Error 40400: no such command');
      expect(out).toContain('✓ editor:save');
    });

    it('input-validation-failure: missing commands throws "commands array is required"', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('execute_command', {});
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('commands array is required');
    });

    it('input-validation-failure: non-array commands throws "commands array is required"', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('execute_command', { commands: 'editor:save' });
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('commands array is required');
    });
  });
});
