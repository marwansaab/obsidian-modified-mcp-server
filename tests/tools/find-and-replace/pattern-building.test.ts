import { describe, it, expect } from 'vitest';

import {
  buildPattern,
  escapeRegex,
  __testing,
} from '../../../src/tools/find-and-replace/pattern-builder.js';

describe('escapeRegex', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegex('a.b')).toBe('a\\.b');
    expect(escapeRegex('a*b')).toBe('a\\*b');
    expect(escapeRegex('a+b?c|d')).toBe('a\\+b\\?c\\|d');
    expect(escapeRegex('(group)')).toBe('\\(group\\)');
    expect(escapeRegex('[set]')).toBe('\\[set\\]');
    expect(escapeRegex('back\\slash')).toBe('back\\\\slash');
    expect(escapeRegex('caret^and$dollar')).toBe('caret\\^and\\$dollar');
    expect(escapeRegex('curly{1,2}')).toBe('curly\\{1,2\\}');
  });

  it('does NOT escape whitespace (so flexibleWhitespace works against escaped output)', () => {
    expect(escapeRegex('a b')).toBe('a b');
    expect(escapeRegex('a  b\tc')).toBe('a  b\tc');
  });
});

describe('buildPattern (literal mode — T010, T016)', () => {
  it('returns literal-string fast path for pure literal mode', () => {
    const p = buildPattern({
      search: 'foo',
      replacement: 'bar',
      regex: false,
      caseSensitive: true,
      wholeWord: false,
      flexibleWhitespace: false,
    });
    expect(p.kind).toBe('literal-string');
    if (p.kind === 'literal-string') {
      expect(p.search).toBe('foo');
      expect(p.replacement).toBe('bar');
    }
  });

  it('returns regex form when caseSensitive: false even in literal mode', () => {
    const p = buildPattern({
      search: 'foo',
      replacement: 'bar',
      regex: false,
      caseSensitive: false,
      wholeWord: false,
      flexibleWhitespace: false,
    });
    expect(p.kind).toBe('regex');
    if (p.kind === 'regex') {
      expect(p.regex.flags).toContain('i');
      expect(p.regex.flags).toContain('g');
      expect(p.regex.flags).toContain('m');
      expect(p.regex.flags).toContain('u');
    }
  });

  it('escapes literal metacharacters when compiling to regex', () => {
    const p = buildPattern({
      search: 'a.b*c',
      replacement: 'X',
      regex: false,
      caseSensitive: false, // forces regex form
      wholeWord: false,
      flexibleWhitespace: false,
    });
    expect(p.kind).toBe('regex');
    if (p.kind === 'regex') {
      // Should match the LITERAL string "a.b*c", not the regex pattern.
      expect('a.b*c'.match(p.regex)).not.toBeNull();
      expect('axbxxc'.match(p.regex)).toBeNull();
    }
  });

  it('wholeWord wraps the pattern in \\b...\\b in literal mode (FR-010)', () => {
    const p = buildPattern({
      search: 'foo',
      replacement: 'bar',
      regex: false,
      caseSensitive: true,
      wholeWord: true,
      flexibleWhitespace: false,
    });
    expect(p.kind).toBe('regex');
    if (p.kind === 'regex') {
      expect('foo bar'.match(p.regex)).not.toBeNull();
      expect('foobar'.match(p.regex)).toBeNull(); // no word boundaries
      expect('barfoo'.match(p.regex)).toBeNull();
    }
  });

  it('flexibleWhitespace substitutes whitespace runs with \\s+ in literal mode (FR-011)', () => {
    const p = buildPattern({
      search: 'foo bar',
      replacement: 'X',
      regex: false,
      caseSensitive: true,
      wholeWord: false,
      flexibleWhitespace: true,
    });
    expect(p.kind).toBe('regex');
    if (p.kind === 'regex') {
      expect('foo bar'.match(p.regex)).not.toBeNull();
      expect('foo  bar'.match(p.regex)).not.toBeNull();
      expect('foo\tbar'.match(p.regex)).not.toBeNull();
      expect('foo\n bar'.match(p.regex)).not.toBeNull();
    }
  });

  it('flexibleWhitespace + wholeWord compose correctly (literal mode)', () => {
    const p = buildPattern({
      search: 'foo bar',
      replacement: 'X',
      regex: false,
      caseSensitive: true,
      wholeWord: true,
      flexibleWhitespace: true,
    });
    expect(p.kind).toBe('regex');
    if (p.kind === 'regex') {
      expect(' foo  bar '.match(p.regex)).not.toBeNull();
      expect('xfoo bary'.match(p.regex)).toBeNull(); // no word boundaries
    }
  });
});

describe('buildPattern flag composition (T010)', () => {
  it('always sets g, m, u flags', () => {
    expect(__testing.buildFlags(true)).toBe('gmu');
  });

  it('adds i when caseSensitive is false', () => {
    expect(__testing.buildFlags(false)).toBe('gimu');
  });

  it('never includes s flag (FR-013)', () => {
    expect(__testing.buildFlags(true)).not.toContain('s');
    expect(__testing.buildFlags(false)).not.toContain('s');
  });
});

describe('buildPattern regex mode (T025, T028)', () => {
  it('compiles a user-provided regex source with the always-on flag set (FR-013)', () => {
    const p = buildPattern({
      search: 'v(\\d+)\\.(\\d+)',
      replacement: 'v$1.$2.0',
      regex: true,
      caseSensitive: true,
      wholeWord: false,
      flexibleWhitespace: false,
    });
    expect(p.kind).toBe('regex');
    if (p.kind === 'regex') {
      expect(p.regex.flags.split('').sort().join('')).toBe('gmu');
      expect(p.regex.source).toBe('v(\\d+)\\.(\\d+)');
    }
  });

  it('adds i flag when caseSensitive: false in regex mode (FR-012)', () => {
    const p = buildPattern({
      search: 'foo',
      replacement: 'bar',
      regex: true,
      caseSensitive: false,
      wholeWord: false,
      flexibleWhitespace: false,
    });
    expect(p.kind).toBe('regex');
    if (p.kind === 'regex') {
      expect(p.regex.flags).toContain('i');
      expect(p.regex.flags).toContain('u');
    }
  });

  it('does NOT escape regex metacharacters in regex mode (user owns them)', () => {
    const p = buildPattern({
      search: 'a.b',
      replacement: 'X',
      regex: true,
      caseSensitive: true,
      wholeWord: false,
      flexibleWhitespace: false,
    });
    expect(p.kind).toBe('regex');
    if (p.kind === 'regex') {
      // a.b in regex mode means "a, any char, b"
      expect('axb'.match(p.regex)).not.toBeNull();
      expect('a.b'.match(p.regex)).not.toBeNull(); // dot also matches dot
    }
  });

  it('wholeWord wraps the regex source in \\b…\\b without escaping (FR-010 regex mode)', () => {
    const p = buildPattern({
      search: 'v\\d+',
      replacement: 'X',
      regex: true,
      caseSensitive: true,
      wholeWord: true,
      flexibleWhitespace: false,
    });
    expect(p.kind).toBe('regex');
    if (p.kind === 'regex') {
      expect('v123 here'.match(p.regex)).not.toBeNull();
      expect('xv123y'.match(p.regex)).toBeNull(); // no word boundary
    }
  });

  it('flexibleWhitespace operates on the regex source (FR-011 regex mode)', () => {
    const p = buildPattern({
      search: 'foo bar',
      replacement: 'X',
      regex: true,
      caseSensitive: true,
      wholeWord: false,
      flexibleWhitespace: true,
    });
    expect(p.kind).toBe('regex');
    if (p.kind === 'regex') {
      expect('foo bar'.match(p.regex)).not.toBeNull();
      expect('foo  \tbar'.match(p.regex)).not.toBeNull();
    }
  });

  it('empty-match regex /^/gm compiles successfully (FR-013, Q3)', () => {
    expect(() =>
      buildPattern({
        search: '^',
        replacement: '> ',
        regex: true,
        caseSensitive: true,
        wholeWord: false,
        flexibleWhitespace: false,
      }),
    ).not.toThrow();
  });

  it('zero-width lookahead regex compiles (FR-013, Q3)', () => {
    expect(() =>
      buildPattern({
        search: '(?=x)',
        replacement: '[',
        regex: true,
        caseSensitive: true,
        wholeWord: false,
        flexibleWhitespace: false,
      }),
    ).not.toThrow();
  });

  it('throws on uncompilable regex (FR-023 helper-layer backstop)', () => {
    expect(() =>
      buildPattern({
        search: '(unclosed',
        replacement: 'X',
        regex: true,
        caseSensitive: true,
        wholeWord: false,
        flexibleWhitespace: false,
      }),
    ).toThrow();
  });
});
