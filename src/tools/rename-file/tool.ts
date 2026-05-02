/**
 * rename_file tool: MCP `Tool[]` registration entry — Option B.
 *
 * The `inputSchema` is derived from `RenameFileRequestSchema` via
 * `zod-to-json-schema` so the published JSON Schema and the runtime
 * validator cannot drift apart (Constitution Principle III).
 *
 * The description text discloses (FR-005) four operational properties
 * that callers need before invoking:
 *   (a) the operation is multi-step and not atomic
 *   (b) the caller should invoke against a clean git working tree
 *       (`git restore .` is the documented rollback baseline)
 *   (c) which wikilink shapes are reliably rewritten (FR-014 catalogue)
 *   (d) the Obsidian "Automatically update internal links" setting is
 *       irrelevant under this implementation
 *
 * Tests in `tests/tools/rename-file/registration.test.ts` pin the four
 * substrings ("multi-step and not atomic", "clean git working tree",
 * "Wikilink shape coverage", and the irrelevance statement) so any
 * accidental edit fails CI.
 *
 * Implementation status: schema and tool registration ship in this
 * commit (Option-B documentation pivot); the handler ships once
 * Tier 2 backlog item 25 (`find_and_replace`) lands and exposes
 * `rest.findAndReplace` on `ObsidianRestService` (FR-013). Until then,
 * `RENAME_FILE_TOOLS` is intentionally NOT included in the `ALL_TOOLS`
 * aggregation in `src/tools/index.ts` — per the project's "no false
 * advertisement" pattern, the tool isn't exposed via `tools/list`
 * until it can actually work.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';

import { RenameFileRequestSchema } from './schema.js';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const inputSchema = zodToJsonSchema(RenameFileRequestSchema, {
  $refStrategy: 'none',
}) as Tool['inputSchema'];

export const RENAME_FILE_TOOLS: Tool[] = [
  {
    name: 'rename_file',
    description:
      'Rename a file in the vault while preserving wikilink integrity vault-wide. ' +
      'Accepts old_path and new_path (both vault-relative). Performs a multi-step ' +
      'composition: pre-flight checks (source exists, destination does not, parent ' +
      'folder exists), reads the source, writes the destination, runs vault-wide ' +
      'wikilink rewrites via find_and_replace, then deletes the source. ' +
      'The operation is multi-step and not atomic. Failure after the destination ' +
      'write leaves the vault in a partial state; the structured response identifies ' +
      'the failed step and what was written. The wrapper performs no automated ' +
      'recovery. ' +
      'Precondition: invoke against a clean git working tree. `git restore .` from ' +
      'the pre-call commit is the documented rollback baseline for any partial state. ' +
      'Wikilink shape coverage. Reliably rewritten on rename: [[basename]], ' +
      '[[basename|alias]], [[basename#heading]], [[basename#heading|alias]], ' +
      '[[basename#^block-id]], ![[basename]], ![[basename|alias]]. For cross-folder ' +
      'renames, full-path forms ([[old-folder/basename]] and variants) are also ' +
      'rewritten. Out of scope: relative-path forms ([[../folder/basename]]) and ' +
      'markdown-style links ([text](path.md)) — callers needing these must perform ' +
      'additional find_and_replace passes themselves. ' +
      'The Obsidian "Automatically update internal links" setting is irrelevant ' +
      'under this implementation. Wikilink integrity comes from the wrapper\'s own ' +
      'regex passes through find_and_replace, not from Obsidian\'s index. The setting ' +
      'need not be enabled and has no effect when toggled. ' +
      'Scope: any vault file (markdown notes and attachments such as images, PDFs, ' +
      'audio). Folder paths are out of scope and will be rejected. Missing parent ' +
      'folders are not auto-created — the caller must ensure the destination folder ' +
      'exists.',
    inputSchema,
  },
];
