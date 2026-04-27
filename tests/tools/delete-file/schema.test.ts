import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';

import { assertValidDeleteFileRequest } from '../../../src/tools/delete-file/schema.js';

describe('delete_file schema validation', () => {
  it('accepts a plain filepath unchanged', () => {
    expect(assertValidDeleteFileRequest({ filepath: 'foo.md' })).toEqual({
      filepath: 'foo.md',
    });
  });

  it('trims surrounding whitespace from filepath', () => {
    expect(assertValidDeleteFileRequest({ filepath: '  foo.md  ' })).toEqual({
      filepath: 'foo.md',
    });
  });

  it('rejects an empty object (filepath missing)', () => {
    try {
      assertValidDeleteFileRequest({});
      expect.fail('expected ZodError');
    } catch (err) {
      expect(err).toBeInstanceOf(ZodError);
      expect((err as ZodError).issues[0]?.path).toContain('filepath');
    }
  });

  it('rejects an empty filepath string', () => {
    expect(() => assertValidDeleteFileRequest({ filepath: '' })).toThrow(ZodError);
  });

  it('rejects whitespace-only filepath (empty after trim)', () => {
    expect(() => assertValidDeleteFileRequest({ filepath: '   ' })).toThrow(ZodError);
  });

  it('preserves vaultId when provided', () => {
    expect(assertValidDeleteFileRequest({ filepath: 'foo.md', vaultId: 'work' })).toEqual({
      filepath: 'foo.md',
      vaultId: 'work',
    });
  });
});
