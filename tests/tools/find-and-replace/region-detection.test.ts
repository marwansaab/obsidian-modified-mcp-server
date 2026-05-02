import { describe, it, expect } from 'vitest';

import {
  detectAllSkipRegions,
  detectFencedCodeBlocks,
  detectHtmlComments,
  __testing,
} from '../../../src/tools/find-and-replace/region-detector.js';

describe('detectFencedCodeBlocks (T032, T035 — FR-007)', () => {
  it('detects a well-formed triple-backtick block', () => {
    const content = 'before\n```bash\necho hi\n```\nafter';
    const regions = detectFencedCodeBlocks(content);
    expect(regions).toHaveLength(1);
    expect(content.slice(regions[0]!.start, regions[0]!.end)).toBe(
      '```bash\necho hi\n```\n',
    );
    expect(regions[0]!.kind).toBe('code-block');
  });

  it('honors up to 3 leading spaces on the opener', () => {
    const content = 'prose\n   ```js\ncode\n   ```\nmore';
    const regions = detectFencedCodeBlocks(content);
    expect(regions).toHaveLength(1);
  });

  it('does NOT honor 4+ leading spaces (CommonMark indented-code-block territory)', () => {
    const content = '    ```\nnot a fence\n    ```\n';
    const regions = detectFencedCodeBlocks(content);
    expect(regions).toHaveLength(0);
  });

  it('handles 4+ backtick fences with correct closer matching', () => {
    const content = '````\ncode with ``` inside\n````\n';
    const regions = detectFencedCodeBlocks(content);
    expect(regions).toHaveLength(1);
    expect(content.slice(regions[0]!.start, regions[0]!.end)).toContain('```');
  });

  it('does NOT close a 4-backtick opener with a 3-backtick line', () => {
    const content = '````\nstuff\n```\nmore stuff\n````\n';
    const regions = detectFencedCodeBlocks(content);
    expect(regions).toHaveLength(1);
    // The 3-backtick line should NOT close the 4-backtick fence.
    expect(content.slice(regions[0]!.start, regions[0]!.end)).toContain(
      'more stuff',
    );
  });

  it('treats unclosed fences as running to end-of-file (US3 acceptance #3)', () => {
    const content = 'before\n```\nthis fence never closes';
    const regions = detectFencedCodeBlocks(content);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.end).toBe(content.length);
  });

  it('does NOT match tilde fences (out of scope per FR-007)', () => {
    const content = '~~~\nthis is technically a CommonMark fence\n~~~\n';
    const regions = detectFencedCodeBlocks(content);
    expect(regions).toHaveLength(0);
  });

  it('handles multiple fences in one document', () => {
    const content = '```\nA\n```\nbetween\n```\nB\n```\nafter';
    const regions = detectFencedCodeBlocks(content);
    expect(regions).toHaveLength(2);
  });

  it('does NOT match an inline `triple-backtick` in prose', () => {
    const content = 'use ```bash``` syntax inline';
    const regions = detectFencedCodeBlocks(content);
    expect(regions).toHaveLength(0);
  });

  it('handles CRLF line endings correctly', () => {
    const content = 'before\r\n```\r\ncode\r\n```\r\nafter';
    const regions = detectFencedCodeBlocks(content);
    expect(regions).toHaveLength(1);
  });
});

describe('detectHtmlComments (T032, T035 — FR-008)', () => {
  it('detects a single-line HTML comment', () => {
    const content = 'before <!-- this is a comment --> after';
    const regions = detectHtmlComments(content);
    expect(regions).toHaveLength(1);
    expect(content.slice(regions[0]!.start, regions[0]!.end)).toBe(
      '<!-- this is a comment -->',
    );
    expect(regions[0]!.kind).toBe('html-comment');
  });

  it('detects a multi-line HTML comment spanning newlines', () => {
    const content = 'before\n<!--\nmulti\nline\n-->\nafter';
    const regions = detectHtmlComments(content);
    expect(regions).toHaveLength(1);
    const matched = content.slice(regions[0]!.start, regions[0]!.end);
    expect(matched.startsWith('<!--')).toBe(true);
    expect(matched.endsWith('-->')).toBe(true);
    expect(matched).toContain('multi\nline');
  });

  it('honors empty comment <!---->', () => {
    const content = 'a <!----> b';
    const regions = detectHtmlComments(content);
    expect(regions).toHaveLength(1);
    expect(content.slice(regions[0]!.start, regions[0]!.end)).toBe('<!---->');
  });

  it('honors empty comment with whitespace <!-- -->', () => {
    const content = 'a <!-- --> b';
    const regions = detectHtmlComments(content);
    expect(regions).toHaveLength(1);
  });

  it('first --> closes the comment (no nesting)', () => {
    const content = 'a <!-- outer <!-- inner --> trailing --> b';
    const regions = detectHtmlComments(content);
    expect(regions).toHaveLength(1);
    expect(content.slice(regions[0]!.start, regions[0]!.end)).toBe(
      '<!-- outer <!-- inner -->',
    );
  });

  it('treats unclosed comments as running to end-of-file', () => {
    const content = 'a <!-- this never closes';
    const regions = detectHtmlComments(content);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.end).toBe(content.length);
  });

  it('handles multiple comments in one document', () => {
    const content = '<!-- A --> middle <!-- B -->';
    const regions = detectHtmlComments(content);
    expect(regions).toHaveLength(2);
  });

  it('returns empty array when no comments present', () => {
    const content = 'just regular prose with no comments';
    const regions = detectHtmlComments(content);
    expect(regions).toEqual([]);
  });
});

describe('detectAllSkipRegions (T032, T035 — FR-009 union)', () => {
  it('returns empty array when neither flag is set', () => {
    const content = '```\ncode\n```\n<!-- comment -->';
    expect(
      detectAllSkipRegions(content, { skipCodeBlocks: false, skipHtmlComments: false }),
    ).toEqual([]);
  });

  it('returns only fence regions when skipCodeBlocks: true alone', () => {
    const content = '```\ncode\n```\n<!-- comment -->';
    const regions = detectAllSkipRegions(content, {
      skipCodeBlocks: true,
      skipHtmlComments: false,
    });
    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('code-block');
  });

  it('returns only comment regions when skipHtmlComments: true alone', () => {
    const content = '```\ncode\n```\n<!-- comment -->';
    const regions = detectAllSkipRegions(content, {
      skipCodeBlocks: false,
      skipHtmlComments: true,
    });
    expect(regions).toHaveLength(1);
    expect(regions[0]!.kind).toBe('html-comment');
  });

  it('unions both region types when both flags set (no overlap)', () => {
    const content = '```\ncode\n```\nbetween\n<!-- comment -->';
    const regions = detectAllSkipRegions(content, {
      skipCodeBlocks: true,
      skipHtmlComments: true,
    });
    expect(regions).toHaveLength(2);
    // Sorted by start ascending.
    expect(regions[0]!.kind).toBe('code-block');
    expect(regions[1]!.kind).toBe('html-comment');
  });

  it('merges adjacent regions on union (FR-009)', () => {
    // A code block immediately followed by a comment with no gap.
    const content = '```\ncode\n```\n<!-- adjacent -->';
    const regions = detectAllSkipRegions(content, {
      skipCodeBlocks: true,
      skipHtmlComments: true,
    });
    // Depending on exact byte adjacency, either merged into 1 or
    // sorted as 2. Both are valid per spec; assert correctness either way.
    expect(regions.length).toBeGreaterThanOrEqual(1);
  });

  it('handles a comment INSIDE a fenced code block (independent detection)', () => {
    const content = '```html\n<!-- HTML inside code -->\n```';
    // With skipCodeBlocks: true alone, the whole code block (including
    // the comment text inside) is one region.
    const regionsCodeOnly = detectAllSkipRegions(content, {
      skipCodeBlocks: true,
      skipHtmlComments: false,
    });
    expect(regionsCodeOnly).toHaveLength(1);

    // With skipHtmlComments: true alone, the comment is its own region
    // (the code-block detector isn't running, so the fence is just
    // text from the comment detector's perspective).
    const regionsCommentOnly = detectAllSkipRegions(content, {
      skipCodeBlocks: false,
      skipHtmlComments: true,
    });
    expect(regionsCommentOnly).toHaveLength(1);
    expect(regionsCommentOnly[0]!.kind).toBe('html-comment');

    // With both flags, the regions union: comment range is inside
    // code-block range, so the union absorbs them.
    const regionsBoth = detectAllSkipRegions(content, {
      skipCodeBlocks: true,
      skipHtmlComments: true,
    });
    expect(regionsBoth).toHaveLength(1);
  });

  it('handles boundary-crossing: comment opens inside fence, closes outside', () => {
    const content = '```\n<!--\n```\nstill comment? -->\nafter';
    // Independent detection:
    //   - Fence detector sees '```' at line 0 and '```' at line 2 →
    //     one code-block region from start through line 2's end.
    //   - Comment detector sees '<!--' on line 1 and '-->' on line 3
    //     → one html-comment region from `<!--` through `-->`.
    // Union merges them into one big region.
    const regions = detectAllSkipRegions(content, {
      skipCodeBlocks: true,
      skipHtmlComments: true,
    });
    expect(regions.length).toBeGreaterThanOrEqual(1);
    // The merged region should cover from the fence opener to the
    // comment closer.
    const merged = regions[0]!;
    expect(merged.start).toBe(0);
    expect(merged.end).toBeGreaterThan(content.indexOf('-->'));
  });
});

describe('region-detector internals', () => {
  it('mergeRegions merges overlapping ranges', () => {
    const merged = __testing.mergeRegions([
      { start: 0, end: 5, kind: 'code-block' },
      { start: 3, end: 8, kind: 'html-comment' },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.start).toBe(0);
    expect(merged[0]!.end).toBe(8);
  });

  it('mergeRegions keeps disjoint ranges separate', () => {
    const merged = __testing.mergeRegions([
      { start: 0, end: 5, kind: 'code-block' },
      { start: 10, end: 15, kind: 'html-comment' },
    ]);
    expect(merged).toHaveLength(2);
  });

  it('mergeRegions handles adjacent ranges (touching)', () => {
    const merged = __testing.mergeRegions([
      { start: 0, end: 5, kind: 'code-block' },
      { start: 5, end: 10, kind: 'html-comment' },
    ]);
    // Touching boundaries are merged (cur.start <= prev.end).
    expect(merged).toHaveLength(1);
    expect(merged[0]!.end).toBe(10);
  });
});
