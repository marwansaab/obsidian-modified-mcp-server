import { describe, it, expect } from 'vitest';

import { buildPattern } from '../../../src/tools/find-and-replace/pattern-builder.js';
import { applyReplacement } from '../../../src/tools/find-and-replace/replacer.js';

function literalPattern(search: string, replacement: string) {
  return buildPattern({
    search,
    replacement,
    regex: false,
    caseSensitive: true,
    wholeWord: false,
    flexibleWhitespace: false,
  });
}

describe('replacer literal mode (T011, T017)', () => {
  it('replaces every occurrence in a single pass (FR-006)', () => {
    const p = literalPattern('foo', 'bar');
    const r = applyReplacement('foo and foo and foo', p);
    expect(r.output).toBe('bar and bar and bar');
    expect(r.replacementCount).toBe(3);
    expect(r.matchesInSkippedRegions).toBe(0);
    expect(r.matches).toHaveLength(3);
  });

  it('does NOT re-scan replacement output (FR-006, Q1) — "old" -> "old-new" terminates', () => {
    const p = literalPattern('old', 'old-new');
    const r = applyReplacement('old', p);
    expect(r.output).toBe('old-new');
    expect(r.replacementCount).toBe(1);
  });

  it('returns byte-identical output when search is absent (FR-014)', () => {
    const p = literalPattern('absent', 'X');
    const original = 'this content has nothing to replace';
    const r = applyReplacement(original, p);
    expect(r.output).toBe(original);
    expect(r.output === original).toBe(true); // identity
    expect(r.replacementCount).toBe(0);
  });

  it('preserves CRLF line endings byte-for-byte (FR-016a)', () => {
    const p = literalPattern('AcmeWidget', 'Globex');
    const original = 'Line one with AcmeWidget\r\nLine two with AcmeWidget\r\nLine three\r\n';
    const r = applyReplacement(original, p);
    expect(r.output).toBe(
      'Line one with Globex\r\nLine two with Globex\r\nLine three\r\n',
    );
    // Spot check: no LF-only sequences introduced.
    expect(r.output.split('\r\n').length).toBe(original.split('\r\n').length);
  });

  it('preserves LF-only line endings byte-for-byte (FR-016a)', () => {
    const p = literalPattern('AcmeWidget', 'Globex');
    const original = 'Line one with AcmeWidget\nLine two\n';
    const r = applyReplacement(original, p);
    expect(r.output).toBe('Line one with Globex\nLine two\n');
    expect(r.output.includes('\r\n')).toBe(false);
  });

  it('preserves trailing-newline state', () => {
    const p = literalPattern('foo', 'bar');
    const withTrailing = 'foo\n';
    const withoutTrailing = 'foo';
    expect(applyReplacement(withTrailing, p).output.endsWith('\n')).toBe(true);
    expect(applyReplacement(withoutTrailing, p).output.endsWith('\n')).toBe(false);
  });

  it('preserves mixed CRLF/LF line endings exactly except at replacement sites', () => {
    const p = literalPattern('X', 'Y');
    const mixed = 'aXb\r\ncXd\neXf\r\n';
    const r = applyReplacement(mixed, p);
    expect(r.output).toBe('aYb\r\ncYd\neYf\r\n');
  });

  it('handles an empty content string', () => {
    const p = literalPattern('foo', 'bar');
    const r = applyReplacement('', p);
    expect(r.output).toBe('');
    expect(r.replacementCount).toBe(0);
  });

  it('records correct startInOriginal offsets', () => {
    const p = literalPattern('ab', 'XY');
    const r = applyReplacement('ab---ab---ab', p);
    expect(r.matches.map((m) => m.startInOriginal)).toEqual([0, 5, 10]);
  });

  it('does not corrupt non-BMP / surrogate-pair characters', () => {
    const p = literalPattern('foo', 'bar');
    const original = 'foo🎉foo🎉foo';
    const r = applyReplacement(original, p);
    expect(r.output).toBe('bar🎉bar🎉bar');
  });
});

describe('replacer skip-region carve-out (T033 — FR-007/FR-008/FR-009/FR-009a)', () => {
  it('preserves bytes inside a skip region byte-for-byte', () => {
    const p = literalPattern('foo', 'bar');
    const content = 'before foo\nSKIP_START foo SKIP_END\nfoo';
    const skipStart = content.indexOf('SKIP_START');
    const skipEnd = content.indexOf('SKIP_END') + 'SKIP_END'.length;
    const r = applyReplacement(content, p, [
      { start: skipStart, end: skipEnd, kind: 'code-block' },
    ]);
    // The matched span should be byte-for-byte preserved.
    const protectedSpan = content.slice(skipStart, skipEnd);
    expect(r.output.slice(skipStart, skipStart + protectedSpan.length)).toBe(
      protectedSpan,
    );
    // Outside-region matches were replaced.
    expect(r.output.startsWith('before bar\n')).toBe(true);
    expect(r.output.endsWith('\nbar')).toBe(true);
    // Two replacements outside the region; one match inside (counted in matchesInSkippedRegions).
    expect(r.replacementCount).toBe(2);
    expect(r.matchesInSkippedRegions).toBe(1);
  });

  it('a single match cannot cross a skip-region boundary (FR-009a)', () => {
    const p = literalPattern('AB', 'XY');
    // Place a skip region between an 'A' and a 'B' that would have
    // matched if joined. The split prevents the cross-boundary match.
    const split = 'AA'; // before
    const skip = 'X'; // skipped span
    const after = 'AB';
    const c = split + skip + after;
    // skipStart = 2 (after "AA"), skipEnd = 3 (after "X")
    const r = applyReplacement(c, p, [
      { start: 2, end: 3, kind: 'code-block' },
    ]);
    // The 'AB' that fully sits inside the post-skip span should match.
    expect(r.replacementCount).toBe(1);
    // The 'A' just before the skip region cannot pair with 'B' after.
    // Verify by checking output structure.
    expect(r.output).toBe('AA' + 'X' + 'XY');
  });

  it('byte-identical no-op when ALL matches are inside skipped regions', () => {
    const p = literalPattern('foo', 'bar');
    const content = 'before SKIP_START foo SKIP_END after';
    const skipStart = content.indexOf('SKIP_START');
    const skipEnd = content.indexOf('SKIP_END') + 'SKIP_END'.length;
    const r = applyReplacement(content, p, [
      { start: skipStart, end: skipEnd, kind: 'code-block' },
    ]);
    expect(r.output).toBe(content);
    expect(r.replacementCount).toBe(0);
    expect(r.matchesInSkippedRegions).toBe(1);
  });

  it('handles multiple non-overlapping skip regions', () => {
    const p = literalPattern('foo', 'X');
    // 0123456789012345678901234567890
    // foo SKIP1 foo MID foo SKIP2 foo
    const content = 'foo SKIP1 foo MID foo SKIP2 foo';
    // Skip "SKIP1 foo" range and "SKIP2 foo" range.
    const r = applyReplacement(content, p, [
      { start: 4, end: 13, kind: 'code-block' }, // "SKIP1 foo"
      { start: 22, end: 31, kind: 'code-block' }, // "SKIP2 foo"
    ]);
    // The first 'foo' (offset 0) and the middle 'foo' (offset 14) are
    // outside all regions, so they get replaced — 2 replacements.
    // The two 'foo's inside skipped regions are preserved.
    expect(r.replacementCount).toBe(2);
    expect(r.matchesInSkippedRegions).toBe(2);
    expect(r.output.startsWith('X SKIP1 foo MID X SKIP2 foo')).toBe(true);
  });

  it('counts matchesInSkippedRegions correctly even when result is no-op', () => {
    const p = literalPattern('foo', 'bar');
    // Place 'foo' only inside the skipped region.
    const content = 'before SKIP foo foo foo SKIP after';
    const skipStart = content.indexOf('SKIP ');
    const skipEnd = content.lastIndexOf('SKIP') + 4;
    const r = applyReplacement(content, p, [
      { start: skipStart, end: skipEnd, kind: 'code-block' },
    ]);
    expect(r.replacementCount).toBe(0);
    expect(r.matchesInSkippedRegions).toBe(3);
    expect(r.output).toBe(content);
  });

  it('regex mode honors skip regions identically', () => {
    const p = buildPattern({
      search: '\\d+',
      replacement: 'NUM',
      regex: true,
      caseSensitive: true,
      wholeWord: false,
      flexibleWhitespace: false,
    });
    const content = 'a 1 b SKIP 2 SKIP c 3 d';
    const skipStart = content.indexOf('SKIP');
    const skipEnd = content.lastIndexOf('SKIP') + 4;
    const r = applyReplacement(content, p, [
      { start: skipStart, end: skipEnd, kind: 'code-block' },
    ]);
    expect(r.replacementCount).toBe(2);
    expect(r.matchesInSkippedRegions).toBe(1);
  });
});

describe('replacer regex mode (T011)', () => {
  function regexPattern(search: string, replacement: string, caseSensitive = true) {
    return buildPattern({
      search,
      replacement,
      regex: true,
      caseSensitive,
      wholeWord: false,
      flexibleWhitespace: false,
    });
  }

  it('replaces with capture-group references ($1, $2)', () => {
    const p = regexPattern('v(\\d+)\\.(\\d+)', 'v$1.$2.0');
    const r = applyReplacement('v1.4 and v2.7', p);
    expect(r.output).toBe('v1.4.0 and v2.7.0');
    expect(r.replacementCount).toBe(2);
  });

  it('replaces with $& (whole match)', () => {
    const p = regexPattern('foo', '[$&]');
    const r = applyReplacement('foo bar foo', p);
    expect(r.output).toBe('[foo] bar [foo]');
  });

  it('replaces with $$ as literal $', () => {
    const p = regexPattern('foo', '$$bar');
    const r = applyReplacement('foo', p);
    expect(r.output).toBe('$bar');
  });

  it('honors caseSensitive: false in regex mode (FR-012)', () => {
    const p = regexPattern('acme', 'Globex', false);
    const r = applyReplacement('Acme ACME acme aCmE', p);
    expect(r.replacementCount).toBe(4);
    expect(r.output).toBe('Globex Globex Globex Globex');
  });

  it('handles ECMAScript Unicode case-folding for accented characters (FR-012, Q2)', () => {
    const p = regexPattern('é', 'X', false);
    const r = applyReplacement('café Café CAFÉ', p);
    // E should match all three accented forms via the i + u flags.
    expect(r.replacementCount).toBe(3);
  });

  it('handles empty-match regex like /^/gm (FR-013, Q3)', () => {
    const p = regexPattern('^', '> ');
    const r = applyReplacement('line one\nline two\nline three', p);
    expect(r.output).toBe('> line one\n> line two\n> line three');
    expect(r.replacementCount).toBe(3);
  });
});
