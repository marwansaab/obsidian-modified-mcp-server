import { describe, it, expect } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { FindAndReplaceRequestSchema } from '../../../src/tools/find-and-replace/schema.js';
import { FIND_AND_REPLACE_TOOLS } from '../../../src/tools/find-and-replace/tool.js';
import { ALL_TOOLS } from '../../../src/tools/index.js';

describe('find_and_replace tool registration (T014, T021, T023)', () => {
  it('FIND_AND_REPLACE_TOOLS exports exactly one entry named find_and_replace', () => {
    expect(FIND_AND_REPLACE_TOOLS).toHaveLength(1);
    expect(FIND_AND_REPLACE_TOOLS[0]?.name).toBe('find_and_replace');
  });

  it('inputSchema is the zod-to-json-schema derivative of FindAndReplaceRequestSchema', () => {
    const entry = FIND_AND_REPLACE_TOOLS[0];
    const expected = zodToJsonSchema(FindAndReplaceRequestSchema, { $refStrategy: 'none' });
    expect(entry?.inputSchema).toEqual(expected);
  });

  it('appears in ALL_TOOLS exactly once (T023)', () => {
    const matching = ALL_TOOLS.filter((t) => t.name === 'find_and_replace');
    expect(matching).toHaveLength(1);
  });

  // FR-003 + R13 — pinned description substrings:
  it('description discloses the clean-git-tree precondition (FR-003a, R13)', () => {
    const description = FIND_AND_REPLACE_TOOLS[0]?.description ?? '';
    expect(description).toContain('clean git working tree');
  });

  it('description discloses the dry-run safety net (FR-003b, R13)', () => {
    const description = FIND_AND_REPLACE_TOOLS[0]?.description ?? '';
    expect(description).toContain('dry-run is the safety net');
  });

  it('description discloses last-write-wins concurrency posture (FR-003c, R13)', () => {
    const description = FIND_AND_REPLACE_TOOLS[0]?.description ?? '';
    expect(description).toContain('last-write-wins');
  });

  it('description warns about case-sensitive pathPrefix matching (R13, Windows footgun)', () => {
    const description = FIND_AND_REPLACE_TOOLS[0]?.description ?? '';
    expect(description).toContain('case-sensitive');
  });
});
