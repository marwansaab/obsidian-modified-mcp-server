import { describe, it, expect } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { ALL_TOOLS } from '../../../src/tools/index.js';
import { RenameFileRequestSchema } from '../../../src/tools/rename-file/schema.js';

describe('rename_file tool registration', () => {
  it('appears in ALL_TOOLS exactly once', () => {
    const matches = ALL_TOOLS.filter((t) => t.name === 'rename_file');
    expect(matches).toHaveLength(1);
  });

  it('inputSchema is the zod-to-json-schema derivative of RenameFileRequestSchema', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'rename_file');
    expect(entry).toBeDefined();
    const expected = zodToJsonSchema(RenameFileRequestSchema, { $refStrategy: 'none' });
    expect(entry?.inputSchema).toEqual(expected);
  });

  it('description includes the link-update precondition (FR-005 / SC-002)', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'rename_file');
    const description = entry?.description ?? '';
    expect(description).toContain('Automatically update internal links');
    expect(description).toContain('Settings → Files & Links');
  });

  it('description includes the folder-out-of-scope clause (FR-001a / Q2)', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'rename_file');
    const description = entry?.description ?? '';
    expect(description).toContain('Folder paths are out of scope');
  });

  it('description includes the no-auto-create clause (FR-012 / Q3)', () => {
    const entry = ALL_TOOLS.find((t) => t.name === 'rename_file');
    const description = entry?.description ?? '';
    expect(description).toContain('Missing parent folders are not auto-created');
  });
});
