import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';

import {
  FindAndReplaceRequestSchema,
  assertValidFindAndReplaceRequest,
} from '../../../src/tools/find-and-replace/schema.js';

describe('find_and_replace schema (T005, T026 regex compile validation)', () => {
  it('rejects an empty search string with field-path "search" (FR-022)', () => {
    expect(() =>
      assertValidFindAndReplaceRequest({ search: '', replacement: 'x' }),
    ).toThrow(ZodError);
    try {
      assertValidFindAndReplaceRequest({ search: '', replacement: 'x' });
    } catch (err) {
      expect(err).toBeInstanceOf(ZodError);
      const zerr = err as ZodError;
      expect(zerr.issues[0]?.path).toEqual(['search']);
    }
  });

  it('accepts a minimal request with required fields only', () => {
    const parsed = assertValidFindAndReplaceRequest({
      search: 'foo',
      replacement: 'bar',
    });
    expect(parsed.search).toBe('foo');
    expect(parsed.replacement).toBe('bar');
  });

  it('applies all default values per FR-002', () => {
    const parsed = assertValidFindAndReplaceRequest({
      search: 'foo',
      replacement: 'bar',
    });
    expect(parsed.regex).toBe(false);
    expect(parsed.caseSensitive).toBe(true);
    expect(parsed.wholeWord).toBe(false);
    expect(parsed.flexibleWhitespace).toBe(false);
    expect(parsed.skipCodeBlocks).toBe(false);
    expect(parsed.skipHtmlComments).toBe(false);
    expect(parsed.dryRun).toBe(false);
    expect(parsed.verbose).toBe(false);
    expect(parsed.pathPrefix).toBeUndefined();
    expect(parsed.vaultId).toBeUndefined();
  });

  it('accepts pathPrefix and vaultId as strings', () => {
    const parsed = assertValidFindAndReplaceRequest({
      search: 'foo',
      replacement: 'bar',
      pathPrefix: 'Projects/',
      vaultId: 'research',
    });
    expect(parsed.pathPrefix).toBe('Projects/');
    expect(parsed.vaultId).toBe('research');
  });

  it('rejects a regex with unbalanced parenthesis with field-path "search" (FR-023)', () => {
    expect(() =>
      assertValidFindAndReplaceRequest({
        search: '(unclosed',
        replacement: 'x',
        regex: true,
      }),
    ).toThrow(ZodError);
    try {
      assertValidFindAndReplaceRequest({
        search: '(unclosed',
        replacement: 'x',
        regex: true,
      });
    } catch (err) {
      const zerr = err as ZodError;
      expect(zerr.issues[0]?.path).toEqual(['search']);
      expect(zerr.issues[0]?.message).toMatch(/Invalid regex/);
    }
  });

  it('does NOT reject the same unbalanced regex when regex: false (literal mode)', () => {
    expect(() =>
      assertValidFindAndReplaceRequest({
        search: '(unclosed',
        replacement: 'x',
        regex: false,
      }),
    ).not.toThrow();
  });

  it('accepts a valid regex with capture groups when regex: true', () => {
    const parsed = assertValidFindAndReplaceRequest({
      search: 'v(\\d+)\\.(\\d+)',
      replacement: 'v$1.$2.0',
      regex: true,
    });
    expect(parsed.search).toBe('v(\\d+)\\.(\\d+)');
    expect(parsed.regex).toBe(true);
  });

  it('FindAndReplaceRequestSchema is the named export consumed by tool.ts', () => {
    // Smoke test the schema reference exists as the named export
    expect(FindAndReplaceRequestSchema).toBeDefined();
  });

  it('rejects extra/unknown top-level keys silently (zod default is to strip)', () => {
    // zod default behavior: strip unknowns, don't throw. This is acceptable —
    // adding `.strict()` would break clients that send forward-compatible
    // additive fields. Pin the current behavior.
    const parsed = FindAndReplaceRequestSchema.parse({
      search: 'foo',
      replacement: 'bar',
      futureField: 'someValue',
    } as Record<string, unknown>);
    expect(parsed.search).toBe('foo');
    expect((parsed as Record<string, unknown>).futureField).toBeUndefined();
  });
});
