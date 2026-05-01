import { describe, it, expect } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { ALL_TOOLS } from '../../../src/tools/index.js';
import { ListTagsRequestSchema } from '../../../src/tools/list-tags/schema.js';

describe('list_tags tool registration', () => {
  it('appears in ALL_TOOLS exactly once', () => {
    const matches = ALL_TOOLS.filter((t) => t.name === 'list_tags');
    expect(matches).toHaveLength(1);
  });

  it('inputSchema is the zod-to-json-schema derivative of ListTagsRequestSchema', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'list_tags');
    expect(entry).toBeDefined();
    const expected = zodToJsonSchema(ListTagsRequestSchema, { $refStrategy: 'none' });
    expect(entry?.inputSchema).toEqual(expected);
  });

  it('description states the inline-and-frontmatter inclusion rule (FR-008)', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'list_tags');
    const description = entry?.description ?? '';
    expect(description).toContain('inline');
    expect(description).toContain('frontmatter');
  });

  it('description states the code-block exclusion rule (FR-008)', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'list_tags');
    const description = entry?.description ?? '';
    expect(description).toContain('fenced code blocks');
  });

  it('description states the hierarchical-tag parent-prefix roll-up (FR-008)', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'list_tags');
    const description = entry?.description ?? '';
    expect(description).toContain('Hierarchical tags');
    expect(description).toContain('parent prefix');
  });
});
