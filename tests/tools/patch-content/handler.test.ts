import nock from 'nock';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ObsidianRestService } from '../../../src/services/obsidian-rest.js';
import { handlePatchContent } from '../../../src/tools/patch-content/handler.js';

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

const VALID_HEADING_TARGET = 'Weekly Review::Action Items';
const VALID_HEADING_ARGS = {
  filepath: 'note.md',
  operation: 'append' as const,
  targetType: 'heading' as const,
  target: VALID_HEADING_TARGET,
  content: '- new item',
};

describe('patch_content handler', () => {
  let rest: ObsidianRestService;

  beforeEach(() => {
    rest = new ObsidianRestService(VAULT);
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('C1: heading patch — verifies FR-005 headers (Operation, Target-Type, Target URL-encoded, Content-Type)', async () => {
    const scope = nock(BASE_URL)
      .patch('/vault/note.md')
      .matchHeader('Operation', 'append')
      .matchHeader('Target-Type', 'heading')
      .matchHeader('Target', encodeURIComponent(VALID_HEADING_TARGET))
      .matchHeader('Content-Type', /text\/markdown/)
      .reply(200, '');

    const result = await handlePatchContent(VALID_HEADING_ARGS, rest);

    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]).toMatchObject({
      type: 'text',
      text: 'Content patched successfully',
    });
    expect(scope.isDone()).toBe(true);
  });

  it('C2b: handler-level bare-target rejection — no HTTP call (verifies SC-001 at integration boundary)', async () => {
    nock.disableNetConnect();
    // No nock scope is primed. A buggy handler that omitted the validator
    // (or called it after rest.patchContent) would surface a
    // NetConnectNotAllowedError instead of the heading-rule error below.
    await expect(
      handlePatchContent(
        {
          filepath: 'note.md',
          operation: 'append',
          targetType: 'heading',
          target: 'Action Items',
          content: '- new item',
        },
        rest
      )
    ).rejects.toThrow(/full H1::H2.*path/);
  });

  it('C8: block pass-through — full header set asserted', async () => {
    const target = 'block-id-anything';
    const scope = nock(BASE_URL)
      .patch('/vault/note.md')
      .matchHeader('Operation', 'append')
      .matchHeader('Target-Type', 'block')
      .matchHeader('Target', encodeURIComponent(target))
      .matchHeader('Content-Type', /text\/markdown/)
      .reply(200, '');

    const result = await handlePatchContent(
      {
        ...VALID_HEADING_ARGS,
        targetType: 'block',
        target,
      },
      rest
    );

    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });

  it('C9: frontmatter pass-through — full header set asserted', async () => {
    const target = 'somefield';
    const scope = nock(BASE_URL)
      .patch('/vault/note.md')
      .matchHeader('Operation', 'append')
      .matchHeader('Target-Type', 'frontmatter')
      .matchHeader('Target', encodeURIComponent(target))
      .matchHeader('Content-Type', /text\/markdown/)
      .reply(200, '');

    const result = await handlePatchContent(
      {
        ...VALID_HEADING_ARGS,
        targetType: 'frontmatter',
        target,
      },
      rest
    );

    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });

  it('C10: upstream returns 404 — surfaced verbatim with code and message', async () => {
    nock(BASE_URL)
      .patch('/vault/note.md')
      .reply(404, { errorCode: 40400, message: 'File or heading not found' });

    await expect(handlePatchContent(VALID_HEADING_ARGS, rest)).rejects.toThrow(
      /Obsidian API Error 40400.*File or heading not found/
    );
  });

  it('C10b: upstream returns 401 (auth failure) — surfaced verbatim with code and message', async () => {
    nock(BASE_URL)
      .patch('/vault/note.md')
      .reply(401, { errorCode: 40100, message: 'Invalid API key' });

    await expect(handlePatchContent(VALID_HEADING_ARGS, rest)).rejects.toThrow(
      /Obsidian API Error 40100.*Invalid API key/
    );
  });

  it('C11: upstream unreachable (transport error) — surfaced with code -1', async () => {
    nock.disableNetConnect();
    // No scope is primed. A valid request will hit the network, which is
    // disabled, so axios surfaces a NetConnectNotAllowedError; safeCall
    // converts it to "Obsidian API Error -1: <message>".
    await expect(handlePatchContent(VALID_HEADING_ARGS, rest)).rejects.toThrow(
      /Obsidian API Error -1/
    );
  });
});
