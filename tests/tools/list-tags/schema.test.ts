import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';

import { assertValidListTagsRequest } from '../../../src/tools/list-tags/schema.js';

describe('list_tags schema validation', () => {
  it('accepts an empty object (no required fields)', () => {
    expect(assertValidListTagsRequest({})).toEqual({});
  });

  it('accepts vaultId when provided', () => {
    expect(assertValidListTagsRequest({ vaultId: 'work' })).toEqual({
      vaultId: 'work',
    });
  });

  it('trims surrounding whitespace from vaultId', () => {
    expect(assertValidListTagsRequest({ vaultId: '  work  ' })).toEqual({
      vaultId: 'work',
    });
  });

  it('rejects a non-string vaultId', () => {
    try {
      assertValidListTagsRequest({ vaultId: 42 });
      expect.fail('expected ZodError');
    } catch (err) {
      expect(err).toBeInstanceOf(ZodError);
      expect((err as ZodError).issues[0]?.path).toContain('vaultId');
    }
  });
});
