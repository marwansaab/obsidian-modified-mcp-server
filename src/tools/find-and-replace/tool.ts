/**
 * find_and_replace tool: MCP `Tool[]` registration entry.
 *
 * The `inputSchema` is derived from `FindAndReplaceRequestSchema` via
 * `zod-to-json-schema` so the published JSON Schema and the runtime
 * validator cannot drift apart (Constitution Principle III).
 *
 * The description text discloses (FR-003 + R13) four operational
 * properties that callers need before invoking, pinned by
 * `tests/tools/find-and-replace/registration.test.ts`:
 *   (a) the operation is destructive and the vault SHOULD be in a
 *       `clean git working tree` before mutations
 *   (b) `dry-run is the safety net` — preview before commit
 *   (c) concurrency posture is `last-write-wins`
 *   (d) `pathPrefix` matching is `case-sensitive` on all platforms
 *       (Windows-user footgun warning)
 */

import { zodToJsonSchema } from 'zod-to-json-schema';

import { FindAndReplaceRequestSchema } from './schema.js';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const inputSchema = zodToJsonSchema(FindAndReplaceRequestSchema, {
  $refStrategy: 'none',
}) as Tool['inputSchema'];

export const FIND_AND_REPLACE_TOOLS: Tool[] = [
  {
    name: 'find_and_replace',
    description:
      'Find and replace text vault-wide across every .md file in the targeted vault. ' +
      'DESTRUCTIVE: this tool rewrites notes in-place. Run with dryRun: true first to ' +
      'preview matches; commit with dryRun: false. The vault SHOULD be in a clean git ' +
      'working tree (or otherwise backed up) before mutations — dry-run is the safety ' +
      'net. Concurrency posture is last-write-wins: if Obsidian (or a sync plugin) ' +
      'writes a note in the gap between the tool\'s read and write, the tool overwrites ' +
      'that external edit without warning. Close Obsidian or pause sync plugins before ' +
      'running mutations on important content. pathPrefix matching is case-sensitive on ' +
      'all platforms (including Windows) and is a directory-segment prefix (no glob ' +
      'expansion). Files in dot-prefixed directories (e.g., .obsidian/, .trash/) are ' +
      'excluded; the per-file size cap is 5 MB on both input and output.',
    inputSchema,
  },
];
