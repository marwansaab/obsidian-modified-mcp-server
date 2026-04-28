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

const makeTimeoutError = () =>
  new AxiosError('timeout of 10000ms exceeded', 'ECONNABORTED');

describe('delete_file single-file branch (spec 005 happy path + spec 007 FR-005 symmetry)', () => {
  let server: ObsidianMCPServer;

  beforeEach(() => {
    server = new ObsidianMCPServer();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('deletes a single file and returns success counts of 0 (happy path — no timeout)', async () => {
    nock(BASE_URL)
      .get('/vault/parent/')
      .reply(200, { files: ['target.md'] });

    nock(BASE_URL).delete('/vault/parent/target.md').reply(200);

    const result = (await server.handleToolCall('delete_file', {
      filepath: 'parent/target.md',
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const text = (result.content?.[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({
      ok: true,
      deletedPath: 'parent/target.md',
      filesRemoved: 0,
      subdirectoriesRemoved: 0,
    });
    expect(nock.isDone()).toBe(true);
  });

  it('single-file DELETE times out; direct-path verify=404 → success (spec 007 FR-005)', async () => {
    nock(BASE_URL)
      .get('/vault/parent/')
      .reply(200, { files: ['target.md'] });
    nock(BASE_URL).delete('/vault/parent/target.md').replyWithError(makeTimeoutError());
    // Direct-path verification on the file URL: 404 → 'absent' → success.
    nock(BASE_URL)
      .get('/vault/parent/target.md')
      .reply(404, { errorCode: 404, message: 'not found' });

    const result = (await server.handleToolCall('delete_file', {
      filepath: 'parent/target.md',
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const text = (result.content?.[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({
      ok: true,
      deletedPath: 'parent/target.md',
      filesRemoved: 0,
      subdirectoriesRemoved: 0,
    });
    expect(text).not.toContain('outcome undetermined');
    expect(nock.isDone()).toBe(true);
  });

  it('single-file DELETE times out; direct-path verify=200 → DeleteDidNotTakeEffectError (spec 007 FR-003 / FR-005)', async () => {
    nock(BASE_URL)
      .get('/vault/parent/')
      .reply(200, { files: ['target.md'] });
    nock(BASE_URL).delete('/vault/parent/target.md').replyWithError(makeTimeoutError());
    // Direct-path verification: file still present.
    nock(BASE_URL).get('/vault/parent/target.md').reply(200, '# still here');

    let captured: unknown;
    try {
      await server.handleToolCall('delete_file', { filepath: 'parent/target.md' });
      throw new Error('expected handler to throw on verified-still-present file');
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    const message = (captured as Error).message;
    expect(message).toBe(
      'delete did not take effect: parent/target.md (filesRemoved=0, subdirectoriesRemoved=0)'
    );
    expect(message).not.toContain('child failed');
    expect(message).not.toContain('outcome undetermined');
    expect(nock.isDone()).toBe(true);
  });
});
