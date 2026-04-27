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

describe('delete_file single-file happy path', () => {
  let server: ObsidianMCPServer;

  beforeEach(() => {
    server = new ObsidianMCPServer();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('deletes a single file and returns success counts of 0', async () => {
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
});
