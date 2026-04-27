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

describe('delete_file not-found scenarios (FR-007 / SC-003)', () => {
  let server: ObsidianMCPServer;

  beforeEach(() => {
    server = new ObsidianMCPServer();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('Scenario A: target absent in parent listing → "not found: <target>"', async () => {
    nock(BASE_URL).get('/vault/parent/').reply(200, { files: ['unrelated.md'] });

    let captured: unknown;
    try {
      await server.handleToolCall('delete_file', { filepath: 'parent/missing.md' });
      throw new Error('expected handler to throw not-found');
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe('not found: parent/missing.md');
    expect(nock.isDone()).toBe(true);
  });

  it('Scenario B: post-deletion vault state — root listing empty → "not found: <target>"', async () => {
    nock(BASE_URL).get('/vault/').reply(200, { files: [] });

    let captured: unknown;
    try {
      await server.handleToolCall('delete_file', { filepath: 'gone.md' });
      throw new Error('expected handler to throw not-found');
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe('not found: gone.md');
    expect(nock.isDone()).toBe(true);
  });

  it('Scenario C: parent listing claims presence but DELETE returns 404 → "not found: <target>"', async () => {
    nock(BASE_URL).get('/vault/parent/').reply(200, { files: ['ghost.md'] });
    nock(BASE_URL)
      .delete('/vault/parent/ghost.md')
      .reply(404, { errorCode: 404, message: 'file not found' });

    let captured: unknown;
    try {
      await server.handleToolCall('delete_file', { filepath: 'parent/ghost.md' });
      throw new Error('expected handler to throw not-found');
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe('not found: parent/ghost.md');
    expect(nock.isDone()).toBe(true);
  });

  it('Scenario D: parent itself does not exist (parent listing returns 404) → message names input target', async () => {
    nock(BASE_URL)
      .get('/vault/no-such-dir/')
      .reply(404, { errorCode: 404, message: 'directory not found' });

    let captured: unknown;
    try {
      await server.handleToolCall('delete_file', { filepath: 'no-such-dir/file.md' });
      throw new Error('expected handler to throw not-found');
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe('not found: no-such-dir/file.md');
    expect(nock.isDone()).toBe(true);
  });
});
