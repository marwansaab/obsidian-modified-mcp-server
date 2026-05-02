/**
 * AS-IS characterization tests for `src/tools/periodic-tools.ts` (T014).
 *
 * Tools: `get_periodic_note`, `get_recent_periodic_notes`, `get_recent_changes`.
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
import { PERIODIC_TOOLS } from '../../../src/tools/periodic-tools.js';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const BASE_URL = 'https://localhost:27123';

const text = (r: CallToolResult): string => (r.content?.[0] as { text: string }).text;

describe('periodic-tools.ts — AS-IS characterization', () => {
  let server: ObsidianMCPServer;

  beforeEach(() => {
    server = new ObsidianMCPServer();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('PERIODIC_TOOLS metadata', () => {
    it('registers the three periodic tools in declared order', () => {
      expect(PERIODIC_TOOLS.map((t) => t.name)).toEqual([
        'get_periodic_note',
        'get_recent_periodic_notes',
        'get_recent_changes',
      ]);
    });

    it('get_periodic_note requires `period` and enumerates the five canonical periods', () => {
      const tool = PERIODIC_TOOLS.find((t) => t.name === 'get_periodic_note');
      expect(tool?.inputSchema?.required).toEqual(['period']);
      const properties = tool?.inputSchema?.properties as { period?: { enum?: string[] } };
      expect(properties.period?.enum).toEqual([
        'daily',
        'weekly',
        'monthly',
        'quarterly',
        'yearly',
      ]);
    });

    it('get_recent_changes has no required fields', () => {
      // The schema lacks a `required` key entirely — read it as such.
      const tool = PERIODIC_TOOLS.find((t) => t.name === 'get_recent_changes');
      expect(tool?.inputSchema?.required).toBeUndefined();
    });
  });

  describe('get_periodic_note dispatcher arm', () => {
    it('happy path content: GETs /periodic/<period>/ and returns body verbatim', async () => {
      nock(BASE_URL).get('/periodic/daily/').reply(200, '# Today');
      const result = await server.handleToolCall('get_periodic_note', { period: 'daily' });
      expect(text(result)).toBe('# Today');
    });

    it('happy path metadata: sends Accept: application/vnd.olrapi.note+json when type=metadata', async () => {
      nock(BASE_URL)
        .matchHeader('Accept', 'application/vnd.olrapi.note+json')
        .get('/periodic/weekly/')
        .reply(200, 'meta payload');
      const result = await server.handleToolCall('get_periodic_note', {
        period: 'weekly',
        type: 'metadata',
      });
      expect(text(result)).toBe('meta payload');
    });

    it('upstream-error path: 404 propagates as ObsidianNotFoundError (responseType:text → axios stock message)', async () => {
      // get_periodic_note is responseType:'text' so error.response.data is a
      // raw JSON string, NOT a parsed object. data.errorCode/data.message are
      // both undefined; the formatted message uses error.message + status.
      nock(BASE_URL).get('/periodic/daily/').reply(404, { errorCode: 40400, message: 'no daily note' });
      let captured: unknown;
      try {
        await server.handleToolCall('get_periodic_note', { period: 'daily' });
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe(
        'Obsidian API Error 404: Request failed with status code 404'
      );
    });

    it('input-validation-failure: missing period throws "period is required"', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('get_periodic_note', {});
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('period is required');
    });
  });

  describe('get_recent_periodic_notes dispatcher arm', () => {
    it('happy path: forwards limit + include_content params and returns JSON-stringified results', async () => {
      const upstream = [{ path: 'daily/2026-05-01.md' }, { path: 'daily/2026-05-02.md' }];
      nock(BASE_URL)
        .get('/periodic/daily/recent')
        .query({ limit: '2', includeContent: 'true' })
        .reply(200, upstream);
      const result = await server.handleToolCall('get_recent_periodic_notes', {
        period: 'daily',
        limit: 2,
        include_content: true,
      });
      expect(JSON.parse(text(result))).toEqual(upstream);
    });

    it('default limit=5 and include_content=false', async () => {
      nock(BASE_URL)
        .get('/periodic/monthly/recent')
        .query({ limit: '5', includeContent: 'false' })
        .reply(200, []);
      await server.handleToolCall('get_recent_periodic_notes', { period: 'monthly' });
    });

    it('upstream-error path: 500 propagates', async () => {
      nock(BASE_URL).get('/periodic/yearly/recent').query(true).reply(500, { errorCode: 500, message: 'oops' });
      let captured: unknown;
      try {
        await server.handleToolCall('get_recent_periodic_notes', { period: 'yearly' });
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('Obsidian API Error 500: oops');
    });

    it('input-validation-failure: missing period throws "period is required"', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('get_recent_periodic_notes', {});
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('period is required');
    });
  });

  describe('get_recent_changes dispatcher arm', () => {
    it('happy path: posts DQL query with default limit=10 days=90 and returns JSON-stringified', async () => {
      const upstream = [{ path: 'a.md', mtime: '2026-05-01' }];
      nock(BASE_URL)
        .matchHeader('Content-Type', 'application/vnd.olrapi.dataview.dql+txt')
        .post('/search/', (body) => typeof body === 'string' && body.includes('LIMIT 10') && body.includes('dur(90 days)'))
        .reply(200, upstream);
      const result = await server.handleToolCall('get_recent_changes', {});
      expect(JSON.parse(text(result))).toEqual(upstream);
    });

    it('respects limit and days args', async () => {
      nock(BASE_URL)
        .post('/search/', (body) => typeof body === 'string' && body.includes('LIMIT 3') && body.includes('dur(7 days)'))
        .reply(200, []);
      await server.handleToolCall('get_recent_changes', { limit: 3, days: 7 });
    });

    it('upstream-error path: 503 propagates', async () => {
      nock(BASE_URL).post('/search/').reply(503, { errorCode: 503, message: 'plugin sleeping' });
      let captured: unknown;
      try {
        await server.handleToolCall('get_recent_changes', {});
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('Obsidian API Error 503: plugin sleeping');
    });
  });
});
