import { describe, it, expect } from 'vitest';

import {
  assertValidGetFrontmatterFieldRequest,
  assertValidGetHeadingContentsRequest,
} from '../../../src/tools/surgical-reads/schema.js';

const baseHeadingArgs = {
  filepath: 'note.md',
};

describe('assertValidGetHeadingContentsRequest — heading-rule rejections (H2-H7)', () => {
  const headingRulePattern = /full H1::H2.*path/;

  function assertHeadingRuleError(input: string, msg: string): void {
    expect(msg).toMatch(headingRulePattern);
    expect(msg).toContain(`received: "${input}"`);
    expect(msg).toContain('e.g.,');
  }

  // H2: bare heading
  it('H2: bare heading "Action Items" is rejected', () => {
    try {
      assertValidGetHeadingContentsRequest({ ...baseHeadingArgs, heading: 'Action Items' });
      throw new Error('expected throw');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assertHeadingRuleError('Action Items', msg);
    }
  });

  // H3: trailing empty
  it('H3: trailing-empty "A::B::" is rejected', () => {
    try {
      assertValidGetHeadingContentsRequest({ ...baseHeadingArgs, heading: 'A::B::' });
      throw new Error('expected throw');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assertHeadingRuleError('A::B::', msg);
    }
  });

  // H4: leading empty
  it('H4: leading-empty "::A::B" is rejected', () => {
    try {
      assertValidGetHeadingContentsRequest({ ...baseHeadingArgs, heading: '::A::B' });
      throw new Error('expected throw');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assertHeadingRuleError('::A::B', msg);
    }
  });

  // H5: middle empty
  it('H5: middle-empty "A::::B" is rejected', () => {
    try {
      assertValidGetHeadingContentsRequest({ ...baseHeadingArgs, heading: 'A::::B' });
      throw new Error('expected throw');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assertHeadingRuleError('A::::B', msg);
    }
  });

  // H6: empty string — caught by zod min(1) BEFORE heading rule, but message
  // still names the offending field. We do NOT assert the heading-rule pattern
  // here because zod fires first (heading.min(1) fails).
  it('H6: empty string "" is rejected by the schema', () => {
    expect(() =>
      assertValidGetHeadingContentsRequest({ ...baseHeadingArgs, heading: '' })
    ).toThrow(/heading/);
  });

  // H7: whitespace-only — passes zod min(1) (length is 3), then fails the
  // heading rule because split('::') yields one segment.
  it('H7: whitespace-only "   " is rejected by the heading rule', () => {
    try {
      assertValidGetHeadingContentsRequest({ ...baseHeadingArgs, heading: '   ' });
      throw new Error('expected throw');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      assertHeadingRuleError('   ', msg);
    }
  });
});

describe('assertValidGetHeadingContentsRequest — zod field-path propagation', () => {
  // Verifies Constitution Principle III: the zod error message names the
  // offending field. We do NOT rewrite zod errors into the heading-rule format.
  it('rejects wrong-type filepath with a message naming the field', () => {
    expect(() =>
      assertValidGetHeadingContentsRequest({
        filepath: 123,
        heading: 'A::B',
      })
    ).toThrow(/filepath/);
  });

  it('rejects empty filepath with a message naming the field', () => {
    expect(() =>
      assertValidGetHeadingContentsRequest({
        filepath: '',
        heading: 'A::B',
      })
    ).toThrow(/filepath/);
  });
});

describe('assertValidGetHeadingContentsRequest — happy path', () => {
  it('accepts a valid heading-path request and returns it typed', () => {
    const result = assertValidGetHeadingContentsRequest({
      filepath: 'note.md',
      heading: 'Weekly Review::Action Items',
    });
    expect(result.heading).toBe('Weekly Review::Action Items');
    expect(result.filepath).toBe('note.md');
  });
});

describe('assertValidGetFrontmatterFieldRequest — field rejections (F7-F8)', () => {
  // F7: empty string — caught by zod min(1).
  it('F7: empty string "" is rejected by the schema', () => {
    expect(() =>
      assertValidGetFrontmatterFieldRequest({ filepath: 'note.md', field: '' })
    ).toThrow(/field/);
  });

  // F8: whitespace-only — passes min(1), caught by .refine().
  it('F8: whitespace-only "   " is rejected by the refinement', () => {
    try {
      assertValidGetFrontmatterFieldRequest({ filepath: 'note.md', field: '   ' });
      throw new Error('expected throw');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).toMatch(/field/);
      expect(msg.toLowerCase()).toContain('whitespace-only');
    }
  });
});

describe('assertValidGetFrontmatterFieldRequest — happy path', () => {
  it('accepts a valid request and returns it typed', () => {
    const result = assertValidGetFrontmatterFieldRequest({
      filepath: 'note.md',
      field: 'status',
    });
    expect(result.filepath).toBe('note.md');
    expect(result.field).toBe('status');
  });
});
