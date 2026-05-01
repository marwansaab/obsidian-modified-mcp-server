import { AxiosError } from 'axios';
import nock from 'nock';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  ObsidianApiError,
  ObsidianTimeoutError,
} from '../../../src/services/obsidian-rest-errors.js';
import { ObsidianRestService } from '../../../src/services/obsidian-rest.js';
import { handleListTags } from '../../../src/tools/list-tags/handler.js';

import type { VaultConfig } from '../../../src/types.js';

const VAULT: VaultConfig = {
  id: 'test',
  apiKey: 'test-api-key',
  host: 'localhost',
  port: 27123,
  protocol: 'https',
  verifySsl: false,
};

const BASE_URL = `${VAULT.protocol}://${VAULT.host}:${VAULT.port}`;

const makeTimeoutError = () =>
  new AxiosError('timeout of 10000ms exceeded', 'ECONNABORTED');

describe('list_tags handler — upstream error pass-through (FR-007, SC-005)', () => {
  let rest: ObsidianRestService;

  beforeEach(() => {
    rest = new ObsidianRestService(VAULT);
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('propagates a 401 with upstream errorCode and message verbatim', async () => {
    const upstreamError = {
      errorCode: 401,
      message: 'Authentication required',
    };

    nock(BASE_URL).get('/tags/').reply(401, upstreamError);

    let captured: unknown;
    try {
      await handleListTags({}, rest);
      throw new Error('expected handleListTags to throw on 401');
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(ObsidianApiError);
    const e = captured as ObsidianApiError;
    expect(e.status).toBe(401);
    expect(e.message).toBe('Obsidian API Error 401: Authentication required');
  });

  it('propagates a 5xx with status and message verbatim', async () => {
    nock(BASE_URL)
      .get('/tags/')
      .reply(500, { errorCode: 500, message: 'internal vault error' });

    let captured: unknown;
    try {
      await handleListTags({}, rest);
      throw new Error('expected handleListTags to throw on 500');
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(ObsidianApiError);
    const e = captured as ObsidianApiError;
    expect(e.status).toBe(500);
    expect(e.message).toBe('Obsidian API Error 500: internal vault error');
  });

  it('propagates a transport timeout as ObsidianTimeoutError', async () => {
    nock(BASE_URL).get('/tags/').replyWithError(makeTimeoutError());

    let captured: unknown;
    try {
      await handleListTags({}, rest);
      throw new Error('expected handleListTags to throw on timeout');
    } catch (err) {
      captured = err;
    }

    expect(captured).toBeInstanceOf(ObsidianTimeoutError);
    const e = captured as ObsidianTimeoutError;
    expect(e.message).toContain('Obsidian API Error');
    expect(e.message).toContain('timeout of 10000ms exceeded');
  });
});
