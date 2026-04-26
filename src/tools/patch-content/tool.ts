/**
 * patch_content tool: MCP `Tool[]` registration entry.
 *
 * The `inputSchema` is derived from `PatchRequestSchema` via
 * `zod-to-json-schema` so that the published schema and the runtime
 * validator cannot drift apart (FR-010).
 */

import { zodToJsonSchema } from 'zod-to-json-schema';

import { PatchRequestSchema } from './schema.js';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const inputSchema = zodToJsonSchema(PatchRequestSchema, {
  $refStrategy: 'none',
}) as Tool['inputSchema'];

export const PATCH_CONTENT_TOOLS: Tool[] = [
  {
    name: 'patch_content',
    description:
      'Insert content relative to a heading, block, or frontmatter in a file. ' +
      'For heading targets, the value MUST be the full path of the heading: ' +
      'at least two non-empty segments separated by "::" (i.e., the H1::H2[::H3...] form). ' +
      'Top-level headings (no parent) are unreachable through this tool — ' +
      'use get_file_contents + put_content for those edits. ' +
      'Headings whose literal text contains "::" are also unreachable through this tool ' +
      '(the validator treats every "::" as a path separator and there is no escape syntax).',
    inputSchema,
  },
];
