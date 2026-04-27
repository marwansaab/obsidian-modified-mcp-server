import { describe, it, expect } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { ALL_TOOLS } from '../../../src/tools/index.js';
import {
  FindSimilarNotesRequestSchema,
  SEMANTIC_TOOLS,
} from '../../../src/tools/semantic-tools.js';

describe('find_similar_notes registration (specs/006 FR-003/7)', () => {
  it('appears in ALL_TOOLS exactly once', () => {
    const matches = ALL_TOOLS.filter((t) => t.name === 'find_similar_notes');
    expect(matches.length).toBe(1);
  });

  it('inputSchema is the zodToJsonSchema derivative of FindSimilarNotesRequestSchema', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'find_similar_notes');
    const expected = zodToJsonSchema(FindSimilarNotesRequestSchema, { $refStrategy: 'none' });
    expect(entry?.inputSchema).toEqual(expected);
  });

  it('description is unchanged from the pre-fix value', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'find_similar_notes');
    expect(entry?.description).toBe('Find notes semantically similar to a given note.');
  });

  it('inputSchema.properties.filepath.description advertises separator-tolerance (FR-007)', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'find_similar_notes');
    const properties = (entry?.inputSchema as {
      properties?: { filepath?: { description?: string } };
    }).properties;
    expect(properties?.filepath?.description).toContain(
      'Forward-slash or backslash separators both accepted'
    );
  });

  it('semantic_search is still registered (regression safety)', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'semantic_search');
    expect(entry).toBeDefined();
  });

  it('SEMANTIC_TOOLS contains exactly two entries', () => {
    expect(SEMANTIC_TOOLS.length).toBe(2);
  });
});
