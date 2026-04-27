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

const BASE_URL = 'https://localhost:27123';

describe('delete_file partial-failure during recursive walk (FR-003 / Q1+Q4)', () => {
  let server: ObsidianMCPServer;

  beforeEach(() => {
    server = new ObsidianMCPServer();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('aborts before final outer delete and reports offender + flat deleted-paths list', async () => {
    nock(BASE_URL).get('/vault/').reply(200, { files: ['dir/'] });
    nock(BASE_URL)
      .get('/vault/dir/')
      .reply(200, { files: ['fileA.md', 'fileB.md', 'fileC.md'] });

    nock(BASE_URL).delete('/vault/dir/fileA.md').reply(200);
    nock(BASE_URL)
      .delete('/vault/dir/fileB.md')
      .reply(500, { errorCode: 500, message: 'permission denied' });

    // fileC.md and outer dir are intentionally NOT mocked: the walk must
    // abort on fileB and never touch them. The handler throws an Error;
    // the MCP dispatcher's outer try/catch wraps it into the
    // {content, isError: true} shape (covered by the dispatcher test).
    let captured: unknown;
    try {
      await server.handleToolCall('delete_file', { filepath: 'dir' });
      throw new Error('expected handler to throw a partial-failure error');
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe(
      'child failed: dir/fileB.md — already deleted: [dir/fileA.md]'
    );

    // Verify that fileC.md and outer dir were never called: nock will have
    // only the parent-listing + dir-listing + 2 deletes consumed.
    expect(nock.isDone()).toBe(true);
  });
});
