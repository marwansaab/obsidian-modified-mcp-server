import nock from 'nock';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

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

describe('list_tags handler — verbatim pass-through', () => {
  let rest: ObsidianRestService;

  beforeEach(() => {
    rest = new ObsidianRestService(VAULT);
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('forwards a populated tag index verbatim, including hierarchical parent-prefix roll-ups (FR-010, FR-012, SC-002, SC-006)', async () => {
    const upstreamBody = {
      tags: [
        { name: 'project', count: 3 },
        { name: 'work/tasks', count: 5 },
        { name: 'work', count: 5 },
      ],
    };

    const scope = nock(BASE_URL)
      .matchHeader('Authorization', `Bearer ${VAULT.apiKey}`)
      .get('/tags/')
      .reply(200, upstreamBody);

    const result = await handleListTags({}, rest);

    expect(result.isError).toBeFalsy();
    const text = (result.content?.[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual(upstreamBody);
    expect(scope.isDone()).toBe(true);
  });

  it('forwards an empty tag index verbatim and does not raise (edge case "Empty vault / no tags")', async () => {
    const upstreamBody = { tags: [] };

    const scope = nock(BASE_URL)
      .matchHeader('Authorization', `Bearer ${VAULT.apiKey}`)
      .get('/tags/')
      .reply(200, upstreamBody);

    const result = await handleListTags({}, rest);

    expect(result.isError).toBeFalsy();
    const text = (result.content?.[0] as { text: string }).text;
    expect(JSON.parse(text)).toEqual(upstreamBody);
    expect(scope.isDone()).toBe(true);
  });
});
