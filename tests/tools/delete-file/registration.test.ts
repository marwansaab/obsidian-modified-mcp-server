import { describe, it, expect } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { DeleteFileRequestSchema } from '../../../src/tools/delete-file/schema.js';
import { ALL_TOOLS } from '../../../src/tools/index.js';

describe('delete_file tool registration', () => {
  it('appears in ALL_TOOLS exactly once', () => {
    const matches = ALL_TOOLS.filter((t) => t.name === 'delete_file');
    expect(matches).toHaveLength(1);
  });

  it('inputSchema is the zod-to-json-schema derivative of DeleteFileRequestSchema', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'delete_file');
    expect(entry).toBeDefined();
    const expected = zodToJsonSchema(DeleteFileRequestSchema, { $refStrategy: 'none' });
    expect(entry?.inputSchema).toEqual(expected);
  });

  it('description contains "recursive" (FR-011 / SC-006)', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'delete_file');
    expect(entry?.description).toMatch(/recursive/);
  });

  it('description advertises timeout coherence (verification or timeout)', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'delete_file');
    const description = entry?.description ?? '';
    expect(description).toMatch(/verification|timeout/);
  });
});
