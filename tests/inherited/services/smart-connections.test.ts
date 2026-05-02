/**
 * AS-IS characterization tests for `src/services/smart-connections.ts` (T018).
 *
 * Encodes the SmartConnectionsService's currently observed behaviour:
 *  - constructor's `enabled = !!vault.smartConnectionsPort` branch
 *  - `isAvailable` status mapping for 200, 503, 404, ECONNABORTED, generic
 *    error, and the not-configured fast path
 *  - `search` happy path + filter passthrough + 503/404/generic error
 *    rethrows as `Error` (note: NOT ObsidianApiError — this service uses
 *    its own error layer rather than the obsidian-rest `safeCall` layer)
 *  - `findSimilar` happy path + 404-fallback message + generic error
 */

import { AxiosError } from 'axios';
import nock from 'nock';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { SmartConnectionsService } from '../../../src/services/smart-connections.js';

import type { VaultConfig } from '../../../src/types.js';

const VAULT: VaultConfig = {
  id: 'test',
  apiKey: 'test-api-key',
  host: 'localhost',
  port: 27123,
  protocol: 'https',
  smartConnectionsPort: 37121,
  verifySsl: false,
};

const BASE_URL = `${VAULT.protocol}://${VAULT.host}:${VAULT.port}`;

const makeTimeoutError = () =>
  new AxiosError('timeout of 3000ms exceeded', 'ECONNABORTED');

describe('SmartConnectionsService — AS-IS characterization', () => {
  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('constructor — enabled branch', () => {
    it('disables the service when smartConnectionsPort is missing', async () => {
      const v: VaultConfig = { ...VAULT, smartConnectionsPort: undefined };
      const svc = new SmartConnectionsService(v);
      const status = await svc.isAvailable();
      expect(status).toEqual({
        available: false,
        message: 'Smart Connections not configured',
      });
    });

    it('enables the service when smartConnectionsPort is set', async () => {
      const svc = new SmartConnectionsService(VAULT);
      nock(BASE_URL)
        .post('/search/smart', { query: 'test', filter: { limit: 1 } })
        .reply(200, { results: [] });
      const status = await svc.isAvailable();
      expect(status).toEqual({
        available: true,
        message: 'Smart Connections available',
      });
    });
  });

  describe('isAvailable error mapping', () => {
    it('returns "Smart Connections plugin not ready" on 503', async () => {
      nock(BASE_URL).post('/search/smart').reply(503);
      const svc = new SmartConnectionsService(VAULT);
      const status = await svc.isAvailable();
      expect(status).toEqual({
        available: false,
        message: 'Smart Connections plugin not ready',
      });
    });

    it('returns "Research MCP Bridge plugin not installed" on 404', async () => {
      nock(BASE_URL).post('/search/smart').reply(404);
      const svc = new SmartConnectionsService(VAULT);
      const status = await svc.isAvailable();
      expect(status).toEqual({
        available: false,
        message: 'Research MCP Bridge plugin not installed',
      });
    });

    it('returns "Connection timeout" on ECONNABORTED', async () => {
      nock(BASE_URL).post('/search/smart').replyWithError(makeTimeoutError());
      const svc = new SmartConnectionsService(VAULT);
      const status = await svc.isAvailable();
      expect(status).toEqual({
        available: false,
        message: 'Connection timeout',
      });
    });

    it('returns axios error.message for any other AxiosError (e.g., 500)', async () => {
      nock(BASE_URL).post('/search/smart').reply(500, { message: 'boom' });
      const svc = new SmartConnectionsService(VAULT);
      const status = await svc.isAvailable();
      expect(status.available).toBe(false);
      expect(status.message).toMatch(/Request failed with status code 500/);
    });
  });

  describe('search', () => {
    it('throws when smartConnectionsPort not configured', async () => {
      const v: VaultConfig = { ...VAULT, smartConnectionsPort: undefined };
      const svc = new SmartConnectionsService(v);
      await expect(svc.search('hello')).rejects.toThrow(
        'Smart Connections not configured for vault "test". Set smartConnectionsPort.'
      );
    });

    it('happy path: posts query + filter (with default limit=10, threshold=0.7) and returns body.results', async () => {
      const upstream = { results: [{ path: 'a.md', score: 0.9 }] };
      nock(BASE_URL)
        .post('/search/smart', {
          query: 'philosophy',
          filter: { limit: 10 },
          threshold: 0.7,
        })
        .reply(200, upstream);
      const svc = new SmartConnectionsService(VAULT);
      const result = await svc.search('philosophy');
      expect(result).toEqual(upstream.results);
    });

    it('passes limit/threshold/folders/excludeFolders into request shape', async () => {
      nock(BASE_URL)
        .post('/search/smart', {
          query: 'q',
          filter: { limit: 5, folders: ['Notes'], excludeFolders: ['Archive'] },
          threshold: 0.42,
        })
        .reply(200, { results: [] });
      const svc = new SmartConnectionsService(VAULT);
      await expect(
        svc.search('q', {
          limit: 5,
          threshold: 0.42,
          folders: ['Notes'],
          excludeFolders: ['Archive'],
        })
      ).resolves.toEqual([]);
    });

    it('returns [] when upstream omits results field', async () => {
      nock(BASE_URL).post('/search/smart').reply(200, {});
      const svc = new SmartConnectionsService(VAULT);
      await expect(svc.search('q')).resolves.toEqual([]);
    });

    it('rethrows 503 as "Smart Connections plugin not available in Obsidian"', async () => {
      nock(BASE_URL).post('/search/smart').reply(503);
      const svc = new SmartConnectionsService(VAULT);
      await expect(svc.search('q')).rejects.toThrow(
        'Smart Connections plugin not available in Obsidian'
      );
    });

    it('rethrows 404 as "Research MCP Bridge plugin not installed"', async () => {
      nock(BASE_URL).post('/search/smart').reply(404);
      const svc = new SmartConnectionsService(VAULT);
      await expect(svc.search('q')).rejects.toThrow(
        'Research MCP Bridge plugin not installed'
      );
    });

    it('rethrows other AxiosError as "Smart Connections error: <axios message>"', async () => {
      nock(BASE_URL).post('/search/smart').reply(500);
      const svc = new SmartConnectionsService(VAULT);
      await expect(svc.search('q')).rejects.toThrow(
        /Smart Connections error: Request failed with status code 500/
      );
    });
  });

  describe('findSimilar', () => {
    it('throws when smartConnectionsPort not configured', async () => {
      const v: VaultConfig = { ...VAULT, smartConnectionsPort: undefined };
      const svc = new SmartConnectionsService(v);
      await expect(svc.findSimilar('note.md')).rejects.toThrow(
        'Smart Connections not configured for vault "test". Set smartConnectionsPort.'
      );
    });

    it('happy path: posts path + default limit=10, threshold=0.5 and returns body.results', async () => {
      const upstream = { results: [{ path: 'b.md', score: 0.8 }] };
      nock(BASE_URL)
        .post('/search/similar', { path: 'note.md', limit: 10, threshold: 0.5 })
        .reply(200, upstream);
      const svc = new SmartConnectionsService(VAULT);
      const result = await svc.findSimilar('note.md');
      expect(result).toEqual(upstream.results);
    });

    it('passes limit/threshold from options', async () => {
      nock(BASE_URL)
        .post('/search/similar', { path: 'note.md', limit: 3, threshold: 0.9 })
        .reply(200, { results: [] });
      const svc = new SmartConnectionsService(VAULT);
      await expect(
        svc.findSimilar('note.md', { limit: 3, threshold: 0.9 })
      ).resolves.toEqual([]);
    });

    it('returns [] when upstream omits results field', async () => {
      nock(BASE_URL).post('/search/similar').reply(200, {});
      const svc = new SmartConnectionsService(VAULT);
      await expect(svc.findSimilar('note.md')).resolves.toEqual([]);
    });

    it('rethrows 404 as the dedicated similar-endpoint-fallback message', async () => {
      nock(BASE_URL).post('/search/similar').reply(404);
      const svc = new SmartConnectionsService(VAULT);
      await expect(svc.findSimilar('note.md')).rejects.toThrow(
        'Similar notes endpoint not available. Use semantic_search with note content instead.'
      );
    });

    it('rethrows other AxiosError as "Smart Connections error: <axios message>"', async () => {
      nock(BASE_URL).post('/search/similar').reply(500);
      const svc = new SmartConnectionsService(VAULT);
      await expect(svc.findSimilar('note.md')).rejects.toThrow(
        /Smart Connections error: Request failed with status code 500/
      );
    });
  });
});
