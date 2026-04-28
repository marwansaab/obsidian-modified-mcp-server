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

  it('description advertises both the recursive contract (spec 005 FR-011) and the direct-path verification mechanism (spec 007 FR-012)', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'delete_file');
    const description = entry?.description ?? '';
    expect(description).toContain('When the path refers to a directory, the deletion is recursive');
    expect(description).toContain('single direct-path verification query');
  });
});
