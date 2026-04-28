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

// Spec 005 FR-013 / FR-008 + spec 007 FR-009 / FR-005: the verify
// callback now uses a direct-path probe (`pathExists`), so each fixture
// mocks the verification query against the deleted target's path itself
// instead of the parent listing.
describe('delete_file timeout-then-verify (spec 005 FR-013 + FR-008; spec 007 FR-009 + FR-005)', () => {
  let server: ObsidianMCPServer;

  beforeEach(() => {
    server = new ObsidianMCPServer();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('Sub-case A: timeout-with-actual-success — direct-path verify=404 → success', async () => {
    nock(BASE_URL).get('/vault/').reply(200, { files: ['emptydir/'] });
    nock(BASE_URL).get('/vault/emptydir/').reply(200, { files: [] });
    nock(BASE_URL).delete('/vault/emptydir').replyWithError(makeTimeoutError());
    // Direct-path verification: target absent on the vault.
    nock(BASE_URL)
      .get('/vault/emptydir/')
      .reply(404, { errorCode: 404, message: 'not found' });

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
    expect(nock.isDone()).toBe(true);
  });

  it('Sub-case B: timeout-with-actual-failure — direct-path verify=200 → DeleteDidNotTakeEffectError', async () => {
    nock(BASE_URL).get('/vault/').reply(200, { files: ['emptydir/'] });
    nock(BASE_URL).get('/vault/emptydir/').reply(200, { files: [] });
    nock(BASE_URL).delete('/vault/emptydir').replyWithError(makeTimeoutError());
    // Direct-path verification: target still present.
    nock(BASE_URL).get('/vault/emptydir/').reply(200, { files: [] });

    let captured: unknown;
    try {
      await server.handleToolCall('delete_file', { filepath: 'emptydir' });
      throw new Error('expected handler to throw on timeout-with-actual-failure');
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    const message = (captured as Error).message;
    // Spec 007 FR-003: outer-target failure surfaces as the new shape,
    // never the spec 005 `child failed:` shape, never `outcome undetermined`.
    expect(message).toBe(
      'delete did not take effect: emptydir (filesRemoved=0, subdirectoriesRemoved=0)'
    );
    expect(message).not.toContain('child failed');
    expect(message).not.toContain('outcome undetermined');
    expect(message).not.toContain('"ok":true');
  });

  it('Sub-case C: timeout-then-verification-also-times-out → outcome undetermined (FR-009)', async () => {
    nock(BASE_URL).get('/vault/').reply(200, { files: ['emptydir/'] });
    nock(BASE_URL).get('/vault/emptydir/').reply(200, { files: [] });
    nock(BASE_URL).delete('/vault/emptydir').replyWithError(makeTimeoutError());
    nock(BASE_URL).get('/vault/emptydir/').replyWithError(makeTimeoutError());

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

  it('Sub-case D: timeout-then-verification-fails-with-503 → outcome undetermined (FR-009)', async () => {
    nock(BASE_URL).get('/vault/').reply(200, { files: ['emptydir/'] });
    nock(BASE_URL).get('/vault/emptydir/').reply(200, { files: [] });
    nock(BASE_URL).delete('/vault/emptydir').replyWithError(makeTimeoutError());
    nock(BASE_URL).get('/vault/emptydir/').reply(503, {
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

  it('Sub-case E: per-item delete timeout-then-verify — walk continues after observed success (FR-008 + spec 007 FR-005)', async () => {
    nock(BASE_URL).get('/vault/').reply(200, { files: ['dir/'] });
    nock(BASE_URL)
      .get('/vault/dir/')
      .reply(200, { files: ['fileA.md', 'fileB.md'] });
    nock(BASE_URL)
      .delete('/vault/dir/fileA.md')
      .replyWithError(makeTimeoutError());
    // Direct-path verification on the per-item file path: 404 → walk continues.
    nock(BASE_URL)
      .get('/vault/dir/fileA.md')
      .reply(404, { errorCode: 404, message: 'not found' });
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
