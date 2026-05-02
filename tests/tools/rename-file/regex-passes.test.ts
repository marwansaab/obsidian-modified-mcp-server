import { describe, it, expect } from 'vitest';

import {
  buildPassA,
  buildPassB,
  buildPassC,
  buildPassD,
  escapeRegex,
} from '../../../src/tools/rename-file/regex-passes.js';

// These tests pin the correctness of the four regex passes that
// `find_and_replace` will run against the vault when `rename_file`
// dispatches them. They are HERMETIC — they construct each pass's
// regex via the buildPassN helpers, instantiate it as a JS RegExp,
// and exercise it against synthetic strings via String.prototype.replace.
//
// They do NOT exercise `find_and_replace` itself (which has its own
// tests in the item-25 feature). They do NOT exercise the handler
// composition (that's handler.test.ts, deferred until item 25 ships).
// The point is to prove the regex correctness in isolation so future
// edits to regex-passes.ts can't silently break the wikilink shape
// coverage promised in FR-014.

function applyPass(pattern: string, replacement: string, input: string): string {
  return input.replace(new RegExp(pattern, 'g'), replacement);
}

describe('escapeRegex utility (research §R10)', () => {
  it('escapes parentheses (common in vault filenames)', () => {
    expect(escapeRegex('Foo (Bar)')).toBe('Foo \\(Bar\\)');
  });

  it('escapes dots, plus, star, question mark', () => {
    expect(escapeRegex('a.b+c*d?e')).toBe('a\\.b\\+c\\*d\\?e');
  });

  it('escapes brackets, braces, pipes, anchors, backslash', () => {
    expect(escapeRegex('[]{}|^$\\')).toBe('\\[\\]\\{\\}\\|\\^\\$\\\\');
  });

  it('leaves alphanumerics and spaces unchanged', () => {
    expect(escapeRegex('Hello World 123')).toBe('Hello World 123');
  });
});

describe('Pass A — bare and aliased wikilinks', () => {
  const inputs = { oldBasename: 'old', newBasename: 'new' };

  it('rewrites a bare wikilink', () => {
    const { pattern, replacement } = buildPassA(inputs);
    expect(applyPass(pattern, replacement, 'See [[old]] please.')).toBe('See [[new]] please.');
  });

  it('rewrites an aliased wikilink and preserves the alias verbatim (FR-004a)', () => {
    const { pattern, replacement } = buildPassA(inputs);
    expect(applyPass(pattern, replacement, 'See [[old|the alias text]].')).toBe(
      'See [[new|the alias text]].'
    );
  });

  it('rewrites multiple bare references in a single string', () => {
    const { pattern, replacement } = buildPassA(inputs);
    expect(applyPass(pattern, replacement, '[[old]] and [[old]] and [[old|alt]]')).toBe(
      '[[new]] and [[new]] and [[new|alt]]'
    );
  });

  it('does NOT match a different basename that begins with the old basename', () => {
    const { pattern, replacement } = buildPassA(inputs);
    expect(applyPass(pattern, replacement, '[[older]] and [[old-extended]]')).toBe(
      '[[older]] and [[old-extended]]'
    );
  });

  it('does NOT match heading-targeted forms (Pass B handles those)', () => {
    const { pattern, replacement } = buildPassA(inputs);
    expect(applyPass(pattern, replacement, '[[old#heading]]')).toBe('[[old#heading]]');
  });

  it('does NOT match embed forms (Pass C handles those)', () => {
    const { pattern, replacement } = buildPassA(inputs);
    expect(applyPass(pattern, replacement, '![[old]]')).toBe('![[old]]');
  });

  it('handles an oldBasename containing regex metacharacters via escapeRegex', () => {
    const { pattern, replacement } = buildPassA({
      oldBasename: 'Foo (Bar).baz',
      newBasename: 'Quux',
    });
    expect(applyPass(pattern, replacement, '[[Foo (Bar).baz]] and [[Foo XBarYbaz]]')).toBe(
      '[[Quux]] and [[Foo XBarYbaz]]'
    );
  });
});

describe('Pass B — heading-targeted wikilinks (with optional alias)', () => {
  const inputs = { oldBasename: 'old', newBasename: 'new' };

  it('rewrites a heading-targeted wikilink', () => {
    const { pattern, replacement } = buildPassB(inputs);
    expect(applyPass(pattern, replacement, '[[old#Some Heading]]')).toBe('[[new#Some Heading]]');
  });

  it('rewrites a heading-targeted wikilink with alias and preserves both', () => {
    const { pattern, replacement } = buildPassB(inputs);
    expect(applyPass(pattern, replacement, '[[old#Some Heading|the heading]]')).toBe(
      '[[new#Some Heading|the heading]]'
    );
  });

  it('rewrites a block-reference wikilink (#^block-id is a valid #… segment)', () => {
    const { pattern, replacement } = buildPassB(inputs);
    expect(applyPass(pattern, replacement, '[[old#^block-abc123]]')).toBe(
      '[[new#^block-abc123]]'
    );
  });

  it('does NOT match a bare wikilink (Pass A handles those)', () => {
    const { pattern, replacement } = buildPassB(inputs);
    expect(applyPass(pattern, replacement, '[[old]]')).toBe('[[old]]');
  });
});

describe('Pass C — embed wikilinks (with optional alias)', () => {
  const inputs = { oldBasename: 'cover.png', newBasename: 'banner.png' };

  it('rewrites a bare embed', () => {
    const { pattern, replacement } = buildPassC(inputs);
    expect(applyPass(pattern, replacement, 'Image: ![[cover.png]] inline.')).toBe(
      'Image: ![[banner.png]] inline.'
    );
  });

  it('rewrites an aliased embed and preserves the alias', () => {
    const { pattern, replacement } = buildPassC(inputs);
    expect(applyPass(pattern, replacement, '![[cover.png|caption text]]')).toBe(
      '![[banner.png|caption text]]'
    );
  });

  it('does NOT match the wikilink form without the leading !', () => {
    const { pattern, replacement } = buildPassC(inputs);
    expect(applyPass(pattern, replacement, '[[cover.png]]')).toBe('[[cover.png]]');
  });

  it('escapes regex metacharacters in attachment basenames (e.g. dots in extensions)', () => {
    const { pattern, replacement } = buildPassC({
      oldBasename: 'cover.png',
      newBasename: 'banner.png',
    });
    // The dot in `cover.png` must be escaped — otherwise it'd match e.g. `coverXpng`.
    expect(applyPass(pattern, replacement, '![[coverXpng]]')).toBe('![[coverXpng]]');
  });
});

describe('Pass D — full-path wikilinks (cross-folder rename only)', () => {
  const inputs = {
    oldBasename: 'draft',
    newBasename: 'overview',
    oldFolder: 'Inbox',
    newFolder: 'Projects/Project-X',
  };

  it('rewrites a bare full-path wikilink', () => {
    const { pattern, replacement } = buildPassD(inputs);
    expect(applyPass(pattern, replacement, 'See [[Inbox/draft]] for context.')).toBe(
      'See [[Projects/Project-X/overview]] for context.'
    );
  });

  it('rewrites a full-path with heading and alias and preserves both', () => {
    const { pattern, replacement } = buildPassD(inputs);
    expect(
      applyPass(pattern, replacement, '[[Inbox/draft#Heading|alias text]]')
    ).toBe('[[Projects/Project-X/overview#Heading|alias text]]');
  });

  it('rewrites a full-path with block reference', () => {
    const { pattern, replacement } = buildPassD(inputs);
    expect(applyPass(pattern, replacement, '[[Inbox/draft#^block-id]]')).toBe(
      '[[Projects/Project-X/overview#^block-id]]'
    );
  });

  it('does NOT match the bare-basename form (Pass A handles those)', () => {
    const { pattern, replacement } = buildPassD(inputs);
    expect(applyPass(pattern, replacement, '[[draft]]')).toBe('[[draft]]');
  });

  it('handles an oldFolder containing regex metacharacters via escapeRegex', () => {
    const { pattern, replacement } = buildPassD({
      oldBasename: 'note',
      newBasename: 'note',
      oldFolder: 'Foo (Bar)',
      newFolder: 'Quux',
    });
    expect(applyPass(pattern, replacement, '[[Foo (Bar)/note]] and [[FooXBarYnote]]')).toBe(
      '[[Quux/note]] and [[FooXBarYnote]]'
    );
  });
});
