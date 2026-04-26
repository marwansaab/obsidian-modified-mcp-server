import nock from 'nock';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ObsidianRestService } from '../../../src/services/obsidian-rest.js';
import { handleGetHeadingContents } from '../../../src/tools/surgical-reads/handler-heading.js';

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

describe('get_heading_contents handler', () => {
  let rest: ObsidianRestService;

  beforeEach(() => {
    rest = new ObsidianRestService(VAULT);
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('H1: heading happy path — verifies URL path + Accept: text/markdown header', async () => {
    const scope = nock(BASE_URL)
      .get('/vault/note.md/heading/Weekly%20Review/Action%20Items')
      .matchHeader('Accept', /text\/markdown/)
      .reply(200, '- item one\n- item two\n');

    const result = await handleGetHeadingContents(
      { filepath: 'note.md', heading: 'Weekly Review::Action Items' },
      rest
    );

    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]).toMatchObject({
      type: 'text',
      text: '- item one\n- item two\n',
    });
    expect(scope.isDone()).toBe(true);
  });

  it('H1b: empty body — passed through verbatim, no synthesized error', async () => {
    nock(BASE_URL).get('/vault/note.md/heading/A/B').reply(200, '');

    const result = await handleGetHeadingContents(
      { filepath: 'note.md', heading: 'A::B' },
      rest
    );

    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]).toMatchObject({ type: 'text', text: '' });
  });

  it('H1c: URL-encodes each heading segment after splitting on "::"', async () => {
    const scope = nock(BASE_URL)
      .get('/vault/note.md/heading/Project/Q3%20%2F%20Plan')
      .matchHeader('Accept', /text\/markdown/)
      .reply(200, '- planned item');

    const result = await handleGetHeadingContents(
      { filepath: 'note.md', heading: 'Project::Q3 / Plan' },
      rest
    );

    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]).toMatchObject({
      type: 'text',
      text: '- planned item',
    });
    expect(scope.isDone()).toBe(true);
  });

  it('H1d: filepath URL-encoding — preserves "/" between folder and filename', async () => {
    const scope = nock(BASE_URL)
      .get('/vault/Folder%20With%20Spaces/note%20name.md/heading/A/B')
      .matchHeader('Accept', /text\/markdown/)
      .reply(200, '- nested item');

    const result = await handleGetHeadingContents(
      { filepath: 'Folder With Spaces/note name.md', heading: 'A::B' },
      rest
    );

    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]).toMatchObject({
      type: 'text',
      text: '- nested item',
    });
    expect(scope.isDone()).toBe(true);
  });

  it('H2b: handler-level bare-target rejection — no HTTP call (verifies SC-001 at integration boundary)', async () => {
    nock.disableNetConnect();
    // No nock scope is primed. A buggy handler that omitted the validator
    // (or called it after rest.getHeadingContents) would surface a
    // NetConnectNotAllowedError instead of the heading-rule error below.
    await expect(
      handleGetHeadingContents(
        { filepath: 'note.md', heading: 'Action Items' },
        rest
      )
    ).rejects.toThrow(/full H1::H2.*path/);
  });

  it('H8: upstream returns 404 — surfaced verbatim with code and message', async () => {
    nock(BASE_URL)
      .get('/vault/note.md/heading/A/B')
      .reply(404, { errorCode: 40400, message: 'File or heading not found' });

    await expect(
      handleGetHeadingContents({ filepath: 'note.md', heading: 'A::B' }, rest)
    ).rejects.toThrow(/Obsidian API Error 40400.*File or heading not found/);
  });

  it('H9: upstream returns 401 (auth failure) — surfaced verbatim', async () => {
    nock(BASE_URL)
      .get('/vault/note.md/heading/A/B')
      .reply(401, { errorCode: 40100, message: 'Invalid API key' });

    await expect(
      handleGetHeadingContents({ filepath: 'note.md', heading: 'A::B' }, rest)
    ).rejects.toThrow(/Obsidian API Error 40100.*Invalid API key/);
  });

  it('H10: upstream unreachable (transport error) — surfaced with code -1', async () => {
    nock.disableNetConnect();
    // No scope primed → axios surfaces a NetConnectNotAllowedError;
    // safeCall converts to "Obsidian API Error -1: <message>".
    await expect(
      handleGetHeadingContents({ filepath: 'note.md', heading: 'A::B' }, rest)
    ).rejects.toThrow(/Obsidian API Error -1/);
  });
});
