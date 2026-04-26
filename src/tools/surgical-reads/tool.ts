/**
 * Surgical-read tools: MCP `Tool[]` registration entries.
 *
 * Each tool's `inputSchema` is derived from its zod schema via
 * `zod-to-json-schema` so the published schema and the runtime
 * validator cannot drift apart (FR-012).
 */

import { zodToJsonSchema } from 'zod-to-json-schema';

import {
  GetFrontmatterFieldRequestSchema,
  GetHeadingContentsRequestSchema,
} from './schema.js';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const headingInputSchema = zodToJsonSchema(GetHeadingContentsRequestSchema, {
  $refStrategy: 'none',
}) as Tool['inputSchema'];

const frontmatterInputSchema = zodToJsonSchema(GetFrontmatterFieldRequestSchema, {
  $refStrategy: 'none',
}) as Tool['inputSchema'];

export const SURGICAL_READ_TOOLS: Tool[] = [
  {
    name: 'get_heading_contents',
    description:
      'Returns the raw markdown body content under the targeted heading. ' +
      'Frontmatter, tags, and file metadata are not included — use get_file_contents ' +
      'for the whole note or get_frontmatter_field for individual frontmatter values. ' +
      'Heading targets MUST use the full path of the heading: at least two non-empty ' +
      'segments separated by "::" (i.e., the H1::H2[::H3...] form). ' +
      'Top-level headings (no parent) are unreachable through this tool — ' +
      'use get_file_contents and slice the note client-side. ' +
      'Headings whose literal text contains "::" are also unreachable through this tool ' +
      '(the validator treats every "::" as a path separator and there is no escape syntax) — ' +
      'use get_file_contents in that case as well.',
    inputSchema: headingInputSchema,
  },
  {
    name: 'get_frontmatter_field',
    description:
      "Returns the named frontmatter field's value with its original type preserved — " +
      'string, number, boolean, array, object, or null. ' +
      "If the field or the note does not exist, the upstream's 4xx error is propagated unchanged. " +
      'To read all frontmatter fields at once, use get_file_contents.',
    inputSchema: frontmatterInputSchema,
  },
];
