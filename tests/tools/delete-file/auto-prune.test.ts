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

// Spec 007 FR-007 (auto-prune regression) + FR-010 (response shape pinning).
// Headline scenario: outer DELETE times out at the transport layer, the
// upstream auto-prunes the now-empty parent as a side-effect, and the
// direct-path verification returns 404 → success response with the spec
// 005 byte-equivalent shape.
describe('delete_file auto-prune (spec 007 FR-007 / FR-010)', () => {
  let server: ObsidianMCPServer;

  beforeEach(() => {
    server = new ObsidianMCPServer();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('parent has only target as child; outer DELETE times out; direct-path verify=404 → success', async () => {
    // Type detection on the parent listing.
    nock(BASE_URL).get('/vault/parent/').reply(200, { files: ['target/'] });
    // Recursive walk lists the target's children.
    nock(BASE_URL)
      .get('/vault/parent/target/')
      .reply(200, { files: ['file-A.md', 'file-B.md'] });
    nock(BASE_URL).delete('/vault/parent/target/file-A.md').reply(200);
    nock(BASE_URL).delete('/vault/parent/target/file-B.md').reply(200);
    // Outer DELETE times out at the transport layer.
    nock(BASE_URL).delete('/vault/parent/target').replyWithError(makeTimeoutError());
    // Direct-path verification: target absent on the vault. The wrapper
    // does NOT consult the parent listing (which would 404 here under
    // auto-prune and was the spec 005 false-undetermined trigger).
    nock(BASE_URL)
      .get('/vault/parent/target/')
      .reply(404, { errorCode: 404, message: 'not found' });

    const result = (await server.handleToolCall('delete_file', {
      filepath: 'parent/target',
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const text = (result.content?.[0] as { text: string }).text;

    // FR-010 / SC-004: byte-equivalent shape — exactly four keys, no
    // verifiedAfterTimeout flag, no extras.
    const parsed = JSON.parse(text);
    expect(parsed).toEqual({
      ok: true,
      deletedPath: 'parent/target',
      filesRemoved: 2,
      subdirectoriesRemoved: 0,
    });
    expect(Object.keys(parsed).sort()).toEqual([
      'deletedPath',
      'filesRemoved',
      'ok',
      'subdirectoriesRemoved',
    ]);

    // Never "outcome undetermined", never any error text.
    expect(text).not.toContain('outcome undetermined');
    expect(text).not.toContain('Obsidian API Error');
    expect(text).not.toContain('timeout');

    expect(nock.isDone()).toBe(true);
  });

  it('multi-level auto-prune cascade: grandparent/parent/target outer-DELETE timeout + verify=404 → success', async () => {
    nock(BASE_URL)
      .get('/vault/grandparent/parent/')
      .reply(200, { files: ['target/'] });
    nock(BASE_URL)
      .get('/vault/grandparent/parent/target/')
      .reply(200, { files: ['leaf.md'] });
    nock(BASE_URL).delete('/vault/grandparent/parent/target/leaf.md').reply(200);
    nock(BASE_URL)
      .delete('/vault/grandparent/parent/target')
      .replyWithError(makeTimeoutError());
    nock(BASE_URL)
      .get('/vault/grandparent/parent/target/')
      .reply(404, { errorCode: 404, message: 'not found' });

    const result = (await server.handleToolCall('delete_file', {
      filepath: 'grandparent/parent/target',
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    const text = (result.content?.[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual({
      ok: true,
      deletedPath: 'grandparent/parent/target',
      filesRemoved: 1,
      subdirectoriesRemoved: 0,
    });
    expect(nock.isDone()).toBe(true);
  });
});
