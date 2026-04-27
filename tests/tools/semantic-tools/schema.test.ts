import { describe, it, expect } from 'vitest';
import { ZodError } from 'zod';

import { assertValidFindSimilarNotesRequest } from '../../../src/tools/semantic-tools.js';

describe('FindSimilarNotesRequestSchema (specs/006 Constitution Principle III)', () => {
  it('accepts a minimal valid input', () => {
    expect(assertValidFindSimilarNotesRequest({ filepath: 'foo.md' })).toEqual({
      filepath: 'foo.md',
    });
  });

  it('accepts a full input with optional fields', () => {
    expect(
      assertValidFindSimilarNotesRequest({
        filepath: 'foo.md',
        limit: 5,
        threshold: 0.7,
        vaultId: 'work',
      })
    ).toEqual({
      filepath: 'foo.md',
      limit: 5,
      threshold: 0.7,
      vaultId: 'work',
    });
  });

  it('rejects missing filepath with field path in error', () => {
    try {
      assertValidFindSimilarNotesRequest({});
      expect.fail('expected ZodError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ZodError);
      const issue = (err as ZodError).errors[0];
      expect(issue.path).toContain('filepath');
    }
  });

  it('rejects empty filepath via .min(1) constraint', () => {
    expect(() => assertValidFindSimilarNotesRequest({ filepath: '' })).toThrow(ZodError);
  });

  it('rejects zero limit', () => {
    expect(() =>
      assertValidFindSimilarNotesRequest({ filepath: 'foo.md', limit: 0 })
    ).toThrow(ZodError);
  });

  it('rejects negative limit', () => {
    expect(() =>
      assertValidFindSimilarNotesRequest({ filepath: 'foo.md', limit: -1 })
    ).toThrow(ZodError);
  });

  it('rejects non-integer limit', () => {
    expect(() =>
      assertValidFindSimilarNotesRequest({ filepath: 'foo.md', limit: 1.5 })
    ).toThrow(ZodError);
  });

  it('rejects threshold above 1', () => {
    expect(() =>
      assertValidFindSimilarNotesRequest({ filepath: 'foo.md', threshold: 1.5 })
    ).toThrow(ZodError);
  });

  it('rejects threshold below 0', () => {
    expect(() =>
      assertValidFindSimilarNotesRequest({ filepath: 'foo.md', threshold: -0.1 })
    ).toThrow(ZodError);
  });
});
