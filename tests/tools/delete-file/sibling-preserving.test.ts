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

// Spec 007 FR-008: parent retains other siblings after the delete (so the
// upstream does NOT auto-prune the parent). The wrapper still queries the
// deleted target's path directly and treats 404 as positive evidence of
// success — independent of parent state.
describe('delete_file sibling-preserving (spec 007 FR-008)', () => {
  let server: ObsidianMCPServer;

  beforeEach(() => {
    server = new ObsidianMCPServer();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('parent retains a sibling; outer DELETE times out; direct-path verify=404 → success', async () => {
    // Type detection: parent contains target/ AND a preserved sibling.
    nock(BASE_URL)
      .get('/vault/parent/')
      .reply(200, { files: ['target/', 'preserved-sibling.md'] });
    nock(BASE_URL)
      .get('/vault/parent/target/')
      .reply(200, { files: ['file-A.md'] });
    nock(BASE_URL).delete('/vault/parent/target/file-A.md').reply(200);
    nock(BASE_URL).delete('/vault/parent/target').replyWithError(makeTimeoutError());
    // Direct-path verification on target — parent state is irrelevant.
    nock(BASE_URL)
      .get('/vault/parent/target/')
      .reply(404, { errorCode: 404, message: 'not found' });

    const result = (await server.handleToolCall('delete_file', {
      filepath: 'parent/target',
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const text = (result.content?.[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({
      ok: true,
      deletedPath: 'parent/target',
      filesRemoved: 1,
      subdirectoriesRemoved: 0,
    });
    expect(text).not.toContain('outcome undetermined');
    expect(nock.isDone()).toBe(true);
  });
});
