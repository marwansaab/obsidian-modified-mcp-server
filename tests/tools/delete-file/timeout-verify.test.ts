import { AxiosError } from 'axios';
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

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const BASE_URL = 'https://localhost:27123';
// nock's replyWithError only fast-fails when given a real Error instance
// with .code set; a plain object falls through to axios's own 10s timer.
// AxiosError ensures safeCall's `instanceof AxiosError` check picks it up.
const makeTimeoutError = () =>
  new AxiosError('timeout of 10000ms exceeded', 'ECONNABORTED');

describe('delete_file timeout-then-verify (FR-013 + FR-008)', () => {
  let server: ObsidianMCPServer;

  beforeEach(() => {
    server = new ObsidianMCPServer();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('Sub-case A: timeout-with-actual-success — verification confirms absent → success', async () => {
    let vaultRootGetCount = 0;
    nock(BASE_URL)
      .get('/vault/')
      .twice()
      .reply(() => {
        vaultRootGetCount += 1;
        if (vaultRootGetCount === 1) return [200, { files: ['emptydir/'] }];
        return [200, { files: [] }];
      });
    nock(BASE_URL).get('/vault/emptydir/').reply(200, { files: [] });
    nock(BASE_URL).delete('/vault/emptydir').replyWithError(makeTimeoutError());

    const result = (await server.handleToolCall('delete_file', {
      filepath: 'emptydir',
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const text = (result.content?.[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({
      ok: true,
      deletedPath: 'emptydir',
      filesRemoved: 0,
      subdirectoriesRemoved: 0,
    });
    expect(text).not.toContain('Obsidian API Error');
    expect(text).not.toContain('timeout');

    // SC-004 lock-in: exactly two GET /vault/ calls — directory detection
    // plus a single post-timeout verification, no retry.
    expect(vaultRootGetCount).toBe(2);
    expect(nock.isDone()).toBe(true);
  });

  it('Sub-case B: timeout-with-actual-failure — verification confirms present → error', async () => {
    nock(BASE_URL)
      .get('/vault/')
      .reply(200, { files: ['emptydir/'] });
    nock(BASE_URL).get('/vault/emptydir/').reply(200, { files: [] });
    nock(BASE_URL).delete('/vault/emptydir').replyWithError(makeTimeoutError());
    nock(BASE_URL).get('/vault/').reply(200, { files: ['emptydir/'] });

    let captured: unknown;
    try {
      await server.handleToolCall('delete_file', { filepath: 'emptydir' });
      throw new Error('expected handler to throw on timeout-with-actual-failure');
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    const message = (captured as Error).message;
    expect(message).toContain('emptydir');
    expect(message).not.toContain('"ok":true');
  });

  it('Sub-case C: timeout-then-verification-also-times-out → outcome undetermined', async () => {
    nock(BASE_URL)
      .get('/vault/')
      .reply(200, { files: ['emptydir/'] });
    nock(BASE_URL).get('/vault/emptydir/').reply(200, { files: [] });
    nock(BASE_URL).delete('/vault/emptydir').replyWithError(makeTimeoutError());
    nock(BASE_URL).get('/vault/').replyWithError(makeTimeoutError());

    let captured: unknown;
    try {
      await server.handleToolCall('delete_file', { filepath: 'emptydir' });
      throw new Error('expected handler to throw on verification timeout');
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe('outcome undetermined for emptydir');
  });

  it('Sub-case D: timeout-then-verification-fails-with-503 → outcome undetermined (uniform handling)', async () => {
    nock(BASE_URL)
      .get('/vault/')
      .reply(200, { files: ['emptydir/'] });
    nock(BASE_URL).get('/vault/emptydir/').reply(200, { files: [] });
    nock(BASE_URL).delete('/vault/emptydir').replyWithError(makeTimeoutError());
    nock(BASE_URL).get('/vault/').reply(503, {
      errorCode: 503,
      message: 'service unavailable',
    });

    let captured: unknown;
    try {
      await server.handleToolCall('delete_file', { filepath: 'emptydir' });
      throw new Error('expected handler to throw on verification 5xx');
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe('outcome undetermined for emptydir');
  });

  it('Sub-case E: per-item delete timeout-then-verify — walk continues after observed success (FR-008)', async () => {
    nock(BASE_URL).get('/vault/').reply(200, { files: ['dir/'] });
    nock(BASE_URL)
      .get('/vault/dir/')
      .reply(200, { files: ['fileA.md', 'fileB.md'] });
    nock(BASE_URL)
      .delete('/vault/dir/fileA.md')
      .replyWithError(makeTimeoutError());
    nock(BASE_URL).get('/vault/dir/').reply(200, { files: ['fileB.md'] });
    nock(BASE_URL).delete('/vault/dir/fileB.md').reply(200);
    nock(BASE_URL).delete('/vault/dir').reply(200);

    const result = (await server.handleToolCall('delete_file', {
      filepath: 'dir',
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const text = (result.content?.[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({
      ok: true,
      deletedPath: 'dir',
      filesRemoved: 2,
      subdirectoriesRemoved: 0,
    });
    expect(nock.isDone()).toBe(true);
  });
});
