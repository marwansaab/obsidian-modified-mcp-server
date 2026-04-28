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

const BASE_URL = 'https://localhost:27123';

const makeTimeoutError = () =>
  new AxiosError('timeout of 10000ms exceeded', 'ECONNABORTED');

// Spec 007 FR-011 (verified-still-present): outer DELETE times out, direct-
// path verification returns 200 (target still present) → wrapper rejects
// with `delete did not take effect: <path> (filesRemoved=<n>, subdirectoriesRemoved=<m>)`.
// Never the spec 005 `child failed:` shape (which is reserved for mid-walk
// per-item failures), never `outcome undetermined`, never success.
describe('delete_file verified-still-present (spec 007 FR-011 / FR-003)', () => {
  let server: ObsidianMCPServer;

  beforeEach(() => {
    server = new ObsidianMCPServer();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('outer DELETE times out; direct-path verify=200 → DeleteDidNotTakeEffectError with summary counts', async () => {
    nock(BASE_URL).get('/vault/').reply(200, { files: ['dir/'] });
    nock(BASE_URL)
      .get('/vault/dir/')
      .reply(200, { files: ['file-A.md', 'file-B.md'] });
    // Per-item child deletes succeed (counts get bumped to 2/0).
    nock(BASE_URL).delete('/vault/dir/file-A.md').reply(200);
    nock(BASE_URL).delete('/vault/dir/file-B.md').reply(200);
    // Outer DELETE times out at the transport layer.
    nock(BASE_URL).delete('/vault/dir').replyWithError(makeTimeoutError());
    // Direct-path verification returns 200 — target still present.
    nock(BASE_URL).get('/vault/dir/').reply(200, { files: [] });

    let captured: unknown;
    try {
      await server.handleToolCall('delete_file', { filepath: 'dir' });
      throw new Error('expected handler to throw on verified-still-present');
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(Error);
    const message = (captured as Error).message;

    // Exact MCP error shape per FR-003.
    expect(message).toBe(
      'delete did not take effect: dir (filesRemoved=2, subdirectoriesRemoved=0)'
    );

    // FR-003 negative assertions: never the per-item-failure shape, never
    // `outcome undetermined`, never a success response.
    expect(message).not.toContain('child failed');
    expect(message).not.toContain('outcome undetermined');
    expect(message).not.toContain('"ok":true');

    expect(nock.isDone()).toBe(true);
  });
});
