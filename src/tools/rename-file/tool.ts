/**
 * rename_file tool: MCP `Tool[]` registration entry.
 *
 * The `inputSchema` is derived from `RenameFileRequestSchema` via
 * `zod-to-json-schema` so the published JSON Schema and the runtime
 * validator cannot drift apart (Constitution Principle III).
 *
 * The description text advertises (FR-005) the precondition that
 * Obsidian's "Automatically update internal links" setting must be
 * enabled for the tool's wikilink-integrity guarantee to hold, and
 * names the UI location of that setting verbatim. It also calls out
 * the folder-out-of-scope rule (FR-001a / Q2) and the no-auto-create
 * rule (FR-012 / Q3) so MCP-aware agents can adopt the tool safely
 * by reading the catalogue alone (User Story 3 / SC-002).
 *
 * Tests in `tests/tools/rename-file/registration.test.ts` pin the
 * four substrings ("Automatically update internal links",
 * "Settings → Files & Links", "Folder paths are out of scope",
 * "Missing parent folders are not auto-created") so that any
 * accidental edit fails CI.
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
      'Accepts old_path and new_path (both vault-relative). Dispatches Obsidian\'s ' +
      'built-in "Rename file" command via the existing command-execution endpoint, ' +
      'so every [[wikilink]] and ![[embed]] referencing the old name is rewritten ' +
      'in the same operation. ' +
      'Precondition: this tool\'s wikilink-integrity guarantee depends on Obsidian\'s ' +
      '"Automatically update internal links" setting being enabled in the focused ' +
      'vault (Settings → Files & Links). If that setting is off, the file rename ' +
      'will still succeed but referencing wikilinks will NOT be rewritten. Verify ' +
      'the setting before relying on this tool. ' +
      'Scope: any vault file (markdown notes and attachments such as images, PDFs, ' +
      'audio). Folder paths are out of scope and will be rejected. Missing parent ' +
      'folders are not auto-created — the caller must ensure the destination folder ' +
      'exists. Errors from the underlying Obsidian command (file not found, ' +
      'destination already exists, missing folder, locked file, etc.) are propagated ' +
      'verbatim.',
    inputSchema,
  },
];
