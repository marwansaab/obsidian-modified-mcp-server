/**
 * AS-IS characterization tests for `src/tools/search-tools.ts` (T011).
 *
 * Tools: `search`, `complex_search`, `pattern_search`. The pattern_search
 * filesystem traversal in `src/index.ts` `runPatternSearch` is covered by
 * T020 (index.test.ts) — this file covers the dispatcher arm's argument
 * validation and the request-shape paths for `search`/`complex_search`.
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
import { SEARCH_TOOLS } from '../../../src/tools/search-tools.js';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const BASE_URL = 'https://localhost:27123';

const text = (r: CallToolResult): string => (r.content?.[0] as { text: string }).text;

describe('search-tools.ts — AS-IS characterization', () => {
  let server: ObsidianMCPServer;

  beforeEach(() => {
    server = new ObsidianMCPServer();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('SEARCH_TOOLS metadata', () => {
    it('registers exactly the three search tools in declared order', () => {
      expect(SEARCH_TOOLS.map((t) => t.name)).toEqual([
        'search',
        'complex_search',
        'pattern_search',
      ]);
    });

    it('search requires `query`', () => {
      expect(SEARCH_TOOLS.find((t) => t.name === 'search')?.inputSchema?.required).toEqual([
        'query',
      ]);
    });

    it('complex_search requires `query`', () => {
      expect(
        SEARCH_TOOLS.find((t) => t.name === 'complex_search')?.inputSchema?.required
      ).toEqual(['query']);
    });

    it('pattern_search requires `patterns`', () => {
      expect(
        SEARCH_TOOLS.find((t) => t.name === 'pattern_search')?.inputSchema?.required
      ).toEqual(['patterns']);
    });
  });

  describe('search dispatcher arm', () => {
    it('happy path: forwards query and contextLength as URL params, JSON-stringifies upstream results', async () => {
      const upstream = [{ filename: 'note.md', score: 0.9, matches: [] }];
      nock(BASE_URL)
        .post('/search/simple/')
        .query({ query: 'phil', contextLength: '200' })
        .reply(200, upstream);
      const result = await server.handleToolCall('search', {
        query: 'phil',
        contextLength: 200,
      });
      expect(JSON.parse(text(result))).toEqual(upstream);
    });

    it('default contextLength=100 when not supplied', async () => {
      nock(BASE_URL)
        .post('/search/simple/')
        .query({ query: 'phil', contextLength: '100' })
        .reply(200, []);
      await server.handleToolCall('search', { query: 'phil' });
    });

    it('upstream-error path: 500 propagates', async () => {
      nock(BASE_URL).post('/search/simple/').query(true).reply(500, { errorCode: 500, message: 'boom' });
      let captured: unknown;
      try {
        await server.handleToolCall('search', { query: 'q' });
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('Obsidian API Error 500: boom');
    });

    it('input-validation-failure: missing query throws "query is required"', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('search', {});
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('query is required');
    });
  });

  describe('complex_search dispatcher arm', () => {
    it('happy path: posts JsonLogic query body and returns JSON-stringified results', async () => {
      const upstream = [{ filename: 'a.md' }];
      const query = { glob: ['*.md', { var: 'path' }] };
      nock(BASE_URL)
        .matchHeader('Content-Type', 'application/vnd.olrapi.jsonlogic+json')
        .post('/search/', query)
        .reply(200, upstream);
      const result = await server.handleToolCall('complex_search', { query });
      expect(JSON.parse(text(result))).toEqual(upstream);
    });

    it('upstream-error path: 400 propagates verbatim', async () => {
      nock(BASE_URL).post('/search/').reply(400, { errorCode: 400, message: 'bad query' });
      let captured: unknown;
      try {
        await server.handleToolCall('complex_search', { query: { glob: ['*'] } });
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('Obsidian API Error 400: bad query');
    });

    it('input-validation-failure: missing query throws "query is required"', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('complex_search', {});
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('query is required');
    });
  });

  describe('pattern_search dispatcher arm — argument validation only', () => {
    it('input-validation-failure: missing patterns throws "patterns array is required"', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('pattern_search', {});
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('patterns array is required');
    });

    it('input-validation-failure: empty patterns array throws "patterns array is required"', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('pattern_search', { patterns: [] });
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('patterns array is required');
    });

    it('input-validation-failure: non-array patterns throws "patterns array is required"', async () => {
      let captured: unknown;
      try {
        await server.handleToolCall('pattern_search', { patterns: 'TODO' });
      } catch (e) {
        captured = e;
      }
      expect((captured as Error).message).toBe('patterns array is required');
    });
  });
});
