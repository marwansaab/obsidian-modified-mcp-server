import { describe, it, expect } from 'vitest';

import {
  assertValidPatchRequest,
  isValidHeadingPath,
} from '../../../src/tools/patch-content/schema.js';

const baseValidArgs = {
  filepath: 'note.md',
  operation: 'append' as const,
  targetType: 'heading' as const,
  content: '- new item',
};

describe('isValidHeadingPath (predicate)', () => {
  it('accepts a 2-segment path', () => {
    expect(isValidHeadingPath('Weekly Review::Action Items')).toBe(true);
  });

  it('accepts a deep path', () => {
    expect(isValidHeadingPath('Project::Plan::Q4::Risks')).toBe(true);
  });

  it('preserves whitespace inside segments (no trim)', () => {
    expect(isValidHeadingPath('  Padded::  Both Sides  ')).toBe(true);
  });

  it('rejects a single-segment value (bare)', () => {
    expect(isValidHeadingPath('Action Items')).toBe(false);
  });

  it('rejects a leading-empty segment', () => {
    expect(isValidHeadingPath('::A::B')).toBe(false);
  });

  it('rejects a trailing-empty segment', () => {
    expect(isValidHeadingPath('A::B::')).toBe(false);
  });

  it('rejects a middle-empty segment', () => {
    expect(isValidHeadingPath('A::::B')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidHeadingPath('')).toBe(false);
  });
});

describe('assertValidPatchRequest — heading-rule rejections (C2-C7)', () => {
  const headingRulePattern = /full H1::H2.*path/;

  function assertHeadingRuleError(input: string, msg: string): void {
    expect(msg).toMatch(headingRulePattern);
    expect(msg).toContain(`received: "${input}"`);
    expect(msg).toContain('e.g.,');
  }

  // C2: bare heading
  it('C2: bare heading "Action Items" is rejected', () => {
    try {
      assertValidPatchRequest({ ...baseValidArgs, target: 'Action Items' });
      throw new Error('expected throw');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assertHeadingRuleError('Action Items', msg);
    }
  });

  // C3: trailing empty
  it('C3: trailing-empty "A::B::" is rejected', () => {
    try {
      assertValidPatchRequest({ ...baseValidArgs, target: 'A::B::' });
      throw new Error('expected throw');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assertHeadingRuleError('A::B::', msg);
    }
  });

  // C4: leading empty
  it('C4: leading-empty "::A::B" is rejected', () => {
    try {
      assertValidPatchRequest({ ...baseValidArgs, target: '::A::B' });
      throw new Error('expected throw');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assertHeadingRuleError('::A::B', msg);
    }
  });

  // C5: middle empty
  it('C5: middle-empty "A::::B" is rejected', () => {
    try {
      assertValidPatchRequest({ ...baseValidArgs, target: 'A::::B' });
      throw new Error('expected throw');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assertHeadingRuleError('A::::B', msg);
    }
  });

  // C6: empty string — caught by zod min(1) BEFORE heading rule, but message
  // still names the offending field. We do NOT assert the heading-rule pattern
  // here because zod fires first (target.min(1) fails).
  it('C6: empty string "" is rejected by the schema', () => {
    expect(() =>
      assertValidPatchRequest({ ...baseValidArgs, target: '' })
    ).toThrow(/target/);
  });

  // C7: whitespace-only — passes zod min(1) (length is 3), then fails the
  // heading rule because split('::') yields one segment.
  it('C7: whitespace-only "   " is rejected by the heading rule', () => {
    try {
      assertValidPatchRequest({ ...baseValidArgs, target: '   ' });
      throw new Error('expected throw');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assertHeadingRuleError('   ', msg);
    }
  });
});

describe('assertValidPatchRequest — zod field-path propagation', () => {
  // Verifies Constitution Principle III: the zod error message names the
  // offending field. We do NOT rewrite zod errors into the heading-rule format.
  it('rejects unknown operation with a message naming the field', () => {
    expect(() =>
      assertValidPatchRequest({
        ...baseValidArgs,
        operation: 'delete',
        target: 'A::B',
      })
    ).toThrow(/operation/);
  });

  it('rejects wrong-type filepath with a message naming the field', () => {
    expect(() =>
      assertValidPatchRequest({
        ...baseValidArgs,
        filepath: 123,
        target: 'A::B',
      })
    ).toThrow(/filepath/);
  });
});

describe('assertValidPatchRequest — pass-through and happy paths', () => {
  it('accepts a valid heading-path request and returns it typed', () => {
    const result = assertValidPatchRequest({
      ...baseValidArgs,
      target: 'Weekly Review::Action Items',
    });
    expect(result.targetType).toBe('heading');
    expect(result.target).toBe('Weekly Review::Action Items');
  });

  it('accepts targetType=block without applying the heading rule', () => {
    const result = assertValidPatchRequest({
      ...baseValidArgs,
      targetType: 'block',
      target: 'block-id-anything',
    });
    expect(result.targetType).toBe('block');
  });

  it('accepts targetType=frontmatter without applying the heading rule', () => {
    const result = assertValidPatchRequest({
      ...baseValidArgs,
      targetType: 'frontmatter',
      target: 'somefield',
    });
    expect(result.targetType).toBe('frontmatter');
  });
});
