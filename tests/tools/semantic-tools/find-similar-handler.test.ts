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
        smartConnectionsPort: 8765,
      },
      'no-smart-connections': {
        id: 'no-smart-connections',
        apiKey: 'test-api-key',
        host: 'localhost',
        port: 27124,
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
const SAMPLE_RESULTS = [
  { path: '000-Meta/Other.md', score: 0.87 },
  { path: '010-Notes/Adjacent.md', score: 0.81 },
];

describe('find_similar_notes dispatch (specs/006 FR-003/4/5/7 + R5 dispatcher gap)', () => {
  let server: ObsidianMCPServer;

  beforeEach(() => {
    server = new ObsidianMCPServer();
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('forward-slash input → POST body path is forward-slash + payload returned (FR-003 happy path)', async () => {
    let capturedBody: { path?: string; limit?: number; threshold?: number } | undefined;
    nock(BASE_URL)
      .post('/search/similar', (body) => {
        capturedBody = body as typeof capturedBody;
        return true;
      })
      .reply(200, { results: SAMPLE_RESULTS });

    const result = (await server.handleToolCall('find_similar_notes', {
      filepath: '000-Meta/Vault Identity.md',
      limit: 5,
      threshold: 0.7,
    })) as CallToolResult;

    expect(result.isError).toBeFalsy();
    expect(capturedBody?.path).toBe('000-Meta/Vault Identity.md');
    expect(capturedBody?.limit).toBe(5);
    expect(capturedBody?.threshold).toBe(0.7);

    const text = (result.content?.[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual(SAMPLE_RESULTS);
    expect(nock.isDone()).toBe(true);
  });

  it('backslash input → POST body path is forward-slash + identical payload to forward-slash call (FR-004 + SC-002)', async () => {
    nock(BASE_URL)
      .post('/search/similar', (body) => {
        const path = (body as { path?: string }).path;
        // The wrapper MUST normalise to forward-slash regardless of input form.
        expect(path).toBe('000-Meta/Vault Identity.md');
        return true;
      })
      .reply(200, { results: SAMPLE_RESULTS });

    const forwardScope = nock(BASE_URL)
      .post('/search/similar')
      .reply(200, { results: SAMPLE_RESULTS });

    const backslashResult = (await server.handleToolCall('find_similar_notes', {
      filepath: '000-Meta\\Vault Identity.md',
    })) as CallToolResult;
    const forwardResult = (await server.handleToolCall('find_similar_notes', {
      filepath: '000-Meta/Vault Identity.md',
    })) as CallToolResult;

    const backslashPayload = JSON.parse(
      (backslashResult.content?.[0] as { text: string }).text
    );
    const forwardPayload = JSON.parse(
      (forwardResult.content?.[0] as { text: string }).text
    );
    expect(backslashPayload).toEqual(forwardPayload);
    expect(forwardScope.isDone()).toBe(true);
  });

  it('mixed-separator input → forward-slash on the wire (FR-005)', async () => {
    let capturedPath: string | undefined;
    nock(BASE_URL)
      .post('/search/similar', (body) => {
        capturedPath = (body as { path?: string }).path;
        return true;
      })
      .reply(200, { results: [] });

    await server.handleToolCall('find_similar_notes', {
      filepath: '000-Meta\\subdir/file.md',
    });

    expect(capturedPath).toBe('000-Meta/subdir/file.md');
  });

  it('vault not configured for Smart Connections → clear error, NOT "Unknown tool" (R5 dispatcher-gap fix)', async () => {
    let captured: unknown;
    try {
      await server.handleToolCall('find_similar_notes', {
        filepath: 'foo.md',
        vaultId: 'no-smart-connections',
      });
      throw new Error('expected handler to throw smartConnectionsPort error');
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    const message = (captured as Error).message;
    expect(message).toContain('smartConnectionsPort');
    expect(message).toContain('no-smart-connections');
    expect(message).not.toContain('Unknown tool');
  });

  it('upstream 404 → fallback message preserved', async () => {
    nock(BASE_URL).post('/search/similar').reply(404, { errorCode: 404, message: 'not found' });

    let captured: unknown;
    try {
      await server.handleToolCall('find_similar_notes', { filepath: 'foo.md' });
      throw new Error('expected handler to throw on upstream 404');
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    const message = (captured as Error).message;
    expect(message).toContain('Similar notes endpoint not available');
    expect(message).not.toContain('Unknown tool');
  });

  it('zod validation failure surfaces filepath field path (NOT "Unknown tool")', async () => {
    let captured: unknown;
    try {
      await server.handleToolCall('find_similar_notes', {});
      throw new Error('expected handler to throw ZodError');
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    const message = (captured as Error).message;
    expect(message).toMatch(/filepath/i);
    expect(message).not.toContain('Unknown tool');
  });
});
