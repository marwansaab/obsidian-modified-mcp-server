import nock from 'nock';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ObsidianRestService } from '../../../src/services/obsidian-rest.js';
import { handleGetFrontmatterField } from '../../../src/tools/surgical-reads/handler-frontmatter.js';

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

const JSON_HEADERS = { 'Content-Type': 'application/json' };

describe('get_frontmatter_field handler — typed-value preservation', () => {
  let rest: ObsidianRestService;

  beforeEach(() => {
    rest = new ObsidianRestService(VAULT);
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('F1: string value — JSON-encoded body, decoded type preserved', async () => {
    const scope = nock(BASE_URL)
      .get('/vault/note.md/frontmatter/status')
      .reply(200, JSON.stringify('in-progress'), JSON_HEADERS);

    const result = await handleGetFrontmatterField(
      { filepath: 'note.md', field: 'status' },
      rest
    );

    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]).toMatchObject({
      type: 'text',
      text: '{"value":"in-progress"}',
    });
    expect(scope.isDone()).toBe(true);
  });

  it('F2: number value preserves its type (not stringified)', async () => {
    nock(BASE_URL)
      .get('/vault/note.md/frontmatter/count')
      .reply(200, JSON.stringify(5), JSON_HEADERS);

    const result = await handleGetFrontmatterField(
      { filepath: 'note.md', field: 'count' },
      rest
    );

    expect(result.content?.[0]).toMatchObject({
      type: 'text',
      text: '{"value":5}',
    });
  });

  it('F3: boolean value preserves its type', async () => {
    nock(BASE_URL)
      .get('/vault/note.md/frontmatter/published')
      .reply(200, JSON.stringify(true), JSON_HEADERS);

    const result = await handleGetFrontmatterField(
      { filepath: 'note.md', field: 'published' },
      rest
    );

    expect(result.content?.[0]).toMatchObject({
      type: 'text',
      text: '{"value":true}',
    });
  });

  it('F4: array value preserves its structure', async () => {
    // nock auto-JSON-encodes object-typed bodies AND auto-sets Content-Type.
    nock(BASE_URL)
      .get('/vault/note.md/frontmatter/aliases')
      .reply(200, ['a', 'b']);

    const result = await handleGetFrontmatterField(
      { filepath: 'note.md', field: 'aliases' },
      rest
    );

    expect(result.content?.[0]).toMatchObject({
      type: 'text',
      text: '{"value":["a","b"]}',
    });
  });

  it('F5: object value preserves its structure', async () => {
    nock(BASE_URL)
      .get('/vault/note.md/frontmatter/meta')
      .reply(200, { x: 1 });

    const result = await handleGetFrontmatterField(
      { filepath: 'note.md', field: 'meta' },
      rest
    );

    expect(result.content?.[0]).toMatchObject({
      type: 'text',
      text: '{"value":{"x":1}}',
    });
  });

  it('F6: present-but-null value is distinct from missing-field (load-bearing)', async () => {
    // CRITICAL: do NOT use .reply(200, null) — nock treats null body as no
    // body, axios receives empty string, and the test would fail or pass
    // for the wrong reason. Use JSON.stringify(null) === 'null' explicitly.
    nock(BASE_URL)
      .get('/vault/note.md/frontmatter/archived')
      .reply(200, JSON.stringify(null), JSON_HEADERS);

    const result = await handleGetFrontmatterField(
      { filepath: 'note.md', field: 'archived' },
      rest
    );

    expect(result.isError).toBeFalsy();
    expect(result.content?.[0]).toMatchObject({
      type: 'text',
      text: '{"value":null}',
    });
  });
});

describe('get_frontmatter_field handler — URL-encoding', () => {
  let rest: ObsidianRestService;

  beforeEach(() => {
    rest = new ObsidianRestService(VAULT);
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('F9: URL-encodes special characters in field name', async () => {
    const scope = nock(BASE_URL)
      .get('/vault/note.md/frontmatter/my%3Acustom')
      .reply(200, JSON.stringify('hi'), JSON_HEADERS);

    const result = await handleGetFrontmatterField(
      { filepath: 'note.md', field: 'my:custom' },
      rest
    );

    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });

  it('F9b: filepath URL-encoding — preserves "/" between folder and filename', async () => {
    const scope = nock(BASE_URL)
      .get('/vault/Folder%20With%20Spaces/note%20name.md/frontmatter/status')
      .reply(200, JSON.stringify('in-progress'), JSON_HEADERS);

    const result = await handleGetFrontmatterField(
      { filepath: 'Folder With Spaces/note name.md', field: 'status' },
      rest
    );

    expect(result.isError).toBeFalsy();
    expect(scope.isDone()).toBe(true);
  });
});

describe('get_frontmatter_field handler — upstream errors', () => {
  let rest: ObsidianRestService;

  beforeEach(() => {
    rest = new ObsidianRestService(VAULT);
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('F10: field-not-found 404 — surfaced as error (distinct from F6 typed-null)', async () => {
    nock(BASE_URL)
      .get('/vault/note.md/frontmatter/missing')
      .reply(404, { errorCode: 40400, message: 'Frontmatter field not found' });

    await expect(
      handleGetFrontmatterField({ filepath: 'note.md', field: 'missing' }, rest)
    ).rejects.toThrow(/Obsidian API Error 40400.*Frontmatter field not found/);
  });

  it('F11: upstream returns 401 (auth failure) — surfaced verbatim', async () => {
    nock(BASE_URL)
      .get('/vault/note.md/frontmatter/status')
      .reply(401, { errorCode: 40100, message: 'Invalid API key' });

    await expect(
      handleGetFrontmatterField({ filepath: 'note.md', field: 'status' }, rest)
    ).rejects.toThrow(/Obsidian API Error 40100.*Invalid API key/);
  });

  it('F12: upstream unreachable (transport error) — surfaced with code -1', async () => {
    nock.disableNetConnect();
    await expect(
      handleGetFrontmatterField({ filepath: 'note.md', field: 'status' }, rest)
    ).rejects.toThrow(/Obsidian API Error -1/);
  });
});
