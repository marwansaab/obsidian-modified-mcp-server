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

describe('delete_file recursive non-empty directory (FR-012)', () => {
  let server: ObsidianMCPServer;

  beforeEach(() => {
    server = new ObsidianMCPServer();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('Block 1: depth-1 happy path with one nested subdirectory in upstream listing order', async () => {
    nock(BASE_URL).get('/vault/').reply(200, { files: ['dir/'] });
    nock(BASE_URL)
      .get('/vault/dir/')
      .reply(200, { files: ['fileA.md', 'sub/', 'fileB.md'] });
    nock(BASE_URL).get('/vault/dir/sub/').reply(200, { files: ['inner.md'] });

    nock(BASE_URL).delete('/vault/dir/fileA.md').reply(200);
    nock(BASE_URL).delete('/vault/dir/sub/inner.md').reply(200);
    nock(BASE_URL).delete('/vault/dir/sub').reply(200);
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
      filesRemoved: 3,
      subdirectoriesRemoved: 1,
    });
    expect(nock.isDone()).toBe(true);
  });

  it('Block 2: depth-2 nested directory recursion', async () => {
    nock(BASE_URL).get('/vault/').reply(200, { files: ['outer/'] });
    nock(BASE_URL).get('/vault/outer/').reply(200, { files: ['mid/'] });
    nock(BASE_URL).get('/vault/outer/mid/').reply(200, { files: ['leaf.md'] });

    nock(BASE_URL).delete('/vault/outer/mid/leaf.md').reply(200);
    nock(BASE_URL).delete('/vault/outer/mid').reply(200);
    nock(BASE_URL).delete('/vault/outer').reply(200);

    const result = (await server.handleToolCall('delete_file', {
      filepath: 'outer',
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const text = (result.content?.[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({
      ok: true,
      deletedPath: 'outer',
      filesRemoved: 1,
      subdirectoriesRemoved: 1,
    });
    expect(nock.isDone()).toBe(true);
  });

  it('Block 3: trailing-slash equivalence — "dir/" and "dir" are the same target (FR-010)', async () => {
    nock(BASE_URL).get('/vault/').reply(200, { files: ['dir/'] });
    nock(BASE_URL)
      .get('/vault/dir/')
      .reply(200, { files: ['fileA.md', 'sub/', 'fileB.md'] });
    nock(BASE_URL).get('/vault/dir/sub/').reply(200, { files: ['inner.md'] });

    nock(BASE_URL).delete('/vault/dir/fileA.md').reply(200);
    nock(BASE_URL).delete('/vault/dir/sub/inner.md').reply(200);
    nock(BASE_URL).delete('/vault/dir/sub').reply(200);
    nock(BASE_URL).delete('/vault/dir/fileB.md').reply(200);
    nock(BASE_URL).delete('/vault/dir').reply(200);

    const result = (await server.handleToolCall('delete_file', {
      filepath: 'dir/',
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const text = (result.content?.[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({
      ok: true,
      deletedPath: 'dir',
      filesRemoved: 3,
      subdirectoriesRemoved: 1,
    });
    expect(nock.isDone()).toBe(true);
  });
});
