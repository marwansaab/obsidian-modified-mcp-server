import { sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  isAbsolutePath,
  toForwardSlashPath,
  toOsNativePath,
} from '../../src/utils/path-normalisation.js';

describe('toOsNativePath', () => {
  it('converts forward-slash separators to path.sep', () => {
    expect(toOsNativePath('a/b/c')).toBe(`a${sep}b${sep}c`);
  });

  it('converts backslash separators to path.sep', () => {
    expect(toOsNativePath('a\\b\\c')).toBe(`a${sep}b${sep}c`);
  });

  it('converts mixed separators to a single canonical form', () => {
    expect(toOsNativePath('a/b\\c')).toBe(`a${sep}b${sep}c`);
    expect(toOsNativePath('a\\b/c')).toBe(`a${sep}b${sep}c`);
  });

  it('returns empty string for empty input', () => {
    expect(toOsNativePath('')).toBe('');
  });

  it('leaves a top-level filename unchanged', () => {
    expect(toOsNativePath('README.md')).toBe('README.md');
  });

  it('preserves a leading separator', () => {
    expect(toOsNativePath('/leading')).toBe(`${sep}leading`);
    expect(toOsNativePath('\\leading')).toBe(`${sep}leading`);
  });

  it('preserves a trailing separator', () => {
    expect(toOsNativePath('trailing/')).toBe(`trailing${sep}`);
    expect(toOsNativePath('trailing\\')).toBe(`trailing${sep}`);
  });

  it('is idempotent', () => {
    const input = 'a/b\\c';
    expect(toOsNativePath(toOsNativePath(input))).toBe(toOsNativePath(input));
  });

  it('preserves input length', () => {
    const input = 'a/b\\c/d\\e';
    expect(toOsNativePath(input).length).toBe(input.length);
  });

  it('preserves non-separator characters verbatim', () => {
    expect(toOsNativePath('000-Meta/Vault Identity.md')).toBe(
      `000-Meta${sep}Vault Identity.md`
    );
  });
});

describe('toForwardSlashPath', () => {
  it('converts backslash separators to forward-slash', () => {
    expect(toForwardSlashPath('a\\b\\c')).toBe('a/b/c');
  });

  it('leaves forward-slash separators unchanged', () => {
    expect(toForwardSlashPath('a/b/c')).toBe('a/b/c');
  });

  it('converts mixed separators to forward-slash', () => {
    expect(toForwardSlashPath('a/b\\c')).toBe('a/b/c');
    expect(toForwardSlashPath('a\\b/c')).toBe('a/b/c');
  });

  it('returns empty string for empty input', () => {
    expect(toForwardSlashPath('')).toBe('');
  });

  it('leaves a top-level filename unchanged', () => {
    expect(toForwardSlashPath('README.md')).toBe('README.md');
  });

  it('preserves a leading separator (transformed)', () => {
    expect(toForwardSlashPath('\\leading')).toBe('/leading');
    expect(toForwardSlashPath('/leading')).toBe('/leading');
  });

  it('preserves a trailing separator (transformed)', () => {
    expect(toForwardSlashPath('trailing\\')).toBe('trailing/');
    expect(toForwardSlashPath('trailing/')).toBe('trailing/');
  });

  it('is idempotent', () => {
    const input = 'a/b\\c';
    expect(toForwardSlashPath(toForwardSlashPath(input))).toBe(
      toForwardSlashPath(input)
    );
  });

  it('preserves input length', () => {
    const input = 'a/b\\c/d\\e';
    expect(toForwardSlashPath(input).length).toBe(input.length);
  });
});

describe('isAbsolutePath invariant under separator transforms', () => {
  it('reports relative input as relative', () => {
    expect(isAbsolutePath('a/b')).toBe(false);
    expect(isAbsolutePath('a\\b')).toBe(false);
    expect(isAbsolutePath('000-Meta/Vault Identity.md')).toBe(false);
  });

  it('agrees pre/post normalisation for the same logical path', () => {
    const input = 'a/b\\c';
    const osNative = toOsNativePath(input);
    const forward = toForwardSlashPath(input);
    expect(isAbsolutePath(input)).toBe(isAbsolutePath(osNative));
    expect(isAbsolutePath(input)).toBe(isAbsolutePath(forward));
  });
});
