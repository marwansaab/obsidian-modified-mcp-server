import { describe, it, expect } from 'vitest';
import { zodToJsonSchema } from 'zod-to-json-schema';

import { RenameFileRequestSchema } from '../../../src/tools/rename-file/schema.js';
import { RENAME_FILE_TOOLS } from '../../../src/tools/rename-file/tool.js';

// NOTE: This test imports RENAME_FILE_TOOLS directly from `./tool.js`
// rather than via `ALL_TOOLS`, because under the Option-B documentation
// pivot the tool is intentionally NOT wired into `ALL_TOOLS` until
// Tier 2 backlog item 25 (find_and_replace) ships and the handler
// (T005) is in. This is the project's "no false advertisement"
// pattern — a registered-but-unimplemented tool would advertise
// capability it can't deliver. When item 25 ships and the handler
// lands, `ALL_TOOLS` regains the entry and an "appears in ALL_TOOLS
// exactly once" assertion can be added back.

describe('rename_file tool registration (Option B)', () => {
  it('RENAME_FILE_TOOLS exports exactly one entry named rename_file', () => {
    expect(RENAME_FILE_TOOLS).toHaveLength(1);
    expect(RENAME_FILE_TOOLS[0]?.name).toBe('rename_file');
  });

  it('inputSchema is the zod-to-json-schema derivative of RenameFileRequestSchema', () => {
    const entry = RENAME_FILE_TOOLS[0];
    const expected = zodToJsonSchema(RenameFileRequestSchema, { $refStrategy: 'none' });
    expect(entry?.inputSchema).toEqual(expected);
  });

  it('description discloses the multi-step / non-atomic nature (FR-005a)', () => {
    const description = RENAME_FILE_TOOLS[0]?.description ?? '';
    expect(description).toContain('multi-step and not atomic');
  });

  it('description discloses the git-clean precondition (FR-005b)', () => {
    const description = RENAME_FILE_TOOLS[0]?.description ?? '';
    expect(description).toContain('clean git working tree');
  });

  it('description discloses the wikilink shape coverage (FR-005c / FR-014)', () => {
    const description = RENAME_FILE_TOOLS[0]?.description ?? '';
    expect(description).toContain('Wikilink shape coverage');
    // Spot-check that at least the bare and embed reliable shapes are listed.
    expect(description).toContain('[[basename]]');
    expect(description).toContain('![[basename]]');
  });

  it('description discloses the irrelevance of the Obsidian setting (FR-005d)', () => {
    const description = RENAME_FILE_TOOLS[0]?.description ?? '';
    expect(description).toContain('"Automatically update internal links" setting is irrelevant');
  });
});
