import { describe, it, expect } from 'vitest';

import {
  buildPreviews,
  __testing,
} from '../../../src/tools/find-and-replace/preview-formatter.js';

import type { RawMatch } from '../../../src/tools/find-and-replace/replacer.js';

describe('preview-formatter (T012, T018)', () => {
  it('returns an empty array for zero matches', () => {
    const previews = buildPreviews([], 'content');
    expect(previews).toEqual([]);
  });

  it('caps at the default of 3 previews per file (FR-015)', () => {
    const matches: RawMatch[] = [];
    const content = ' abc abc abc abc abc';
    let pos = 0;
    while (true) {
      const idx = content.indexOf('abc', pos);
      if (idx === -1) break;
      matches.push({ startInOriginal: idx, match: 'abc', replacement: 'XYZ' });
      pos = idx + 3;
    }
    expect(matches.length).toBe(5);
    const previews = buildPreviews(matches, content);
    expect(previews).toHaveLength(3);
  });

  it('builds the structured per-match shape with 1-based indices', () => {
    const content = 'abc def ghi';
    const matches: RawMatch[] = [
      { startInOriginal: 0, match: 'abc', replacement: 'XYZ' },
      { startInOriginal: 4, match: 'def', replacement: 'XYZ' },
    ];
    const previews = buildPreviews(matches, content);
    expect(previews[0]).toMatchObject({
      matchIndex: 1,
      lineNumber: 1,
      columnStart: 1,
      match: 'abc',
      replacement: 'XYZ',
    });
    expect(previews[1]).toMatchObject({
      matchIndex: 2,
      lineNumber: 1,
      columnStart: 5,
      match: 'def',
    });
  });

  it('truncates context to 40 code points by default (R9)', () => {
    const left = 'A'.repeat(100);
    const right = 'B'.repeat(100);
    const content = `${left}match${right}`;
    const matches: RawMatch[] = [
      { startInOriginal: 100, match: 'match', replacement: 'X' },
    ];
    const previews = buildPreviews(matches, content);
    expect(Array.from(previews[0]!.before).length).toBe(40);
    expect(Array.from(previews[0]!.after).length).toBe(40);
    expect(previews[0]!.before).toBe('A'.repeat(40));
    expect(previews[0]!.after).toBe('B'.repeat(40));
  });

  it('truncates by code points, NOT code units, for non-BMP characters (R9)', () => {
    // 🎉 is one code point but two UTF-16 code units (surrogate pair).
    // Truncating to 40 code POINTS should keep 40 emojis intact, NOT
    // split a surrogate pair.
    const emojiBlock = '🎉'.repeat(50); // 50 code points, 100 code units
    const content = `${emojiBlock}match`;
    const matches: RawMatch[] = [
      { startInOriginal: 100, match: 'match', replacement: 'X' },
    ];
    const previews = buildPreviews(matches, content);
    const beforeArr = Array.from(previews[0]!.before);
    expect(beforeArr.length).toBe(40);
    // Each element should be a complete emoji, not a half-surrogate.
    expect(beforeArr.every((c) => c === '🎉')).toBe(true);
  });

  it('preserves newlines literally in context (FR-015)', () => {
    const content = 'line one\nline two\nMATCH\nline four';
    const matches: RawMatch[] = [
      { startInOriginal: content.indexOf('MATCH'), match: 'MATCH', replacement: 'X' },
    ];
    const previews = buildPreviews(matches, content);
    expect(previews[0]!.before).toContain('\n');
    expect(previews[0]!.after).toContain('\n');
  });

  it('reports correct lineNumber and columnStart for matches on different lines', () => {
    const content = 'line one\nline two\nMATCH on three';
    const matches: RawMatch[] = [
      { startInOriginal: content.indexOf('MATCH'), match: 'MATCH', replacement: 'X' },
    ];
    const previews = buildPreviews(matches, content);
    expect(previews[0]!.lineNumber).toBe(3);
    expect(previews[0]!.columnStart).toBe(1);
  });

  it('handles CRLF correctly (lineNumber counts CRLF as one break)', () => {
    const content = 'one\r\ntwo\r\nMATCH';
    const matches: RawMatch[] = [
      { startInOriginal: content.indexOf('MATCH'), match: 'MATCH', replacement: 'X' },
    ];
    const previews = buildPreviews(matches, content);
    expect(previews[0]!.lineNumber).toBe(3);
    expect(previews[0]!.columnStart).toBe(1);
  });

  it('honors a custom maxPreviews option', () => {
    const matches: RawMatch[] = [
      { startInOriginal: 0, match: 'a', replacement: 'b' },
      { startInOriginal: 2, match: 'a', replacement: 'b' },
    ];
    const previews = buildPreviews(matches, 'a a', { maxPreviews: 1 });
    expect(previews).toHaveLength(1);
  });

  it('honors a custom maxContextCodePoints option', () => {
    const content = 'A'.repeat(20) + 'X' + 'B'.repeat(20);
    const matches: RawMatch[] = [
      { startInOriginal: 20, match: 'X', replacement: 'Y' },
    ];
    const previews = buildPreviews(matches, content, { maxContextCodePoints: 5 });
    expect(Array.from(previews[0]!.before).length).toBe(5);
    expect(Array.from(previews[0]!.after).length).toBe(5);
  });
});

describe('preview-formatter internals', () => {
  it('takeFirstCodePoints respects code-point boundaries', () => {
    expect(__testing.takeFirstCodePoints('🎉🎉🎉', 2)).toBe('🎉🎉');
    expect(__testing.takeFirstCodePoints('abc', 5)).toBe('abc');
    expect(__testing.takeFirstCodePoints('', 5)).toBe('');
  });

  it('takeLastCodePoints respects code-point boundaries', () => {
    expect(__testing.takeLastCodePoints('🎉🎉🎉', 2)).toBe('🎉🎉');
    expect(__testing.takeLastCodePoints('abc', 5)).toBe('abc');
    expect(__testing.takeLastCodePoints('', 5)).toBe('');
  });

  it('locate returns 1-based line and column', () => {
    expect(__testing.locate('hello', 0)).toEqual({ lineNumber: 1, columnStart: 1 });
    expect(__testing.locate('hello', 2)).toEqual({ lineNumber: 1, columnStart: 3 });
    expect(__testing.locate('a\nbc', 2)).toEqual({ lineNumber: 2, columnStart: 1 });
    expect(__testing.locate('a\r\nbc', 3)).toEqual({ lineNumber: 2, columnStart: 1 });
  });
});
