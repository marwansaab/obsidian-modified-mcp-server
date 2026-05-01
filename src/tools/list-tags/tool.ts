/**
 * list_tags tool: MCP `Tool[]` registration entry.
 *
 * The `inputSchema` is derived from `ListTagsRequestSchema` via
 * `zod-to-json-schema` so the published JSON Schema and the runtime
 * validator cannot drift apart (Constitution Principle III).
 *
 * The description text advertises (FR-008) the three properties that
 * make this tool more accurate than text/frontmatter search for tag
 * enumeration: inline + frontmatter inclusion, code-block exclusion,
 * and the upstream's hierarchical parent-prefix roll-up. Tests in
 * `tests/tools/list-tags/registration.test.ts` pin each clause.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';

import { ListTagsRequestSchema } from './schema.js';

import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const inputSchema = zodToJsonSchema(ListTagsRequestSchema, {
  $refStrategy: 'none',
}) as Tool['inputSchema'];

export const LIST_TAGS_TOOLS: Tool[] = [
  {
    name: 'list_tags',
    description:
      'List every tag present in the vault, together with its usage count. ' +
      "The result is sourced from Obsidian's own tag index via the Local REST API " +
      "plugin's GET /tags/ endpoint, so it includes both inline (#tag) and YAML " +
      'frontmatter tags and excludes tag-shaped strings that appear inside fenced ' +
      'code blocks — making it more accurate than text or frontmatter search for tag ' +
      'enumeration. Hierarchical tags (e.g., work/tasks) contribute counts to every ' +
      "parent prefix (e.g., work), matching how Obsidian's own tag sidebar displays them.",
    inputSchema,
  },
];
