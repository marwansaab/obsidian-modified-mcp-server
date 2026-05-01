/**
 * list_tags tool: input schema (zod) + boundary validator.
 *
 * Single source of truth for both the runtime parser and the published
 * MCP `inputSchema` (the latter is derived via `zod-to-json-schema` in
 * `./tool.ts`). See specs/008-tag-management/data-model.md and
 * contracts/list_tags.md for the authoritative definitions.
 */

import { z } from 'zod';

export const ListTagsRequestSchema = z.object({
  vaultId: z
    .string()
    .trim()
    .optional()
    .describe('Optional vault ID (defaults to configured default vault).'),
});

export type ListTagsRequest = z.infer<typeof ListTagsRequestSchema>;

export function assertValidListTagsRequest(args: unknown): ListTagsRequest {
  return ListTagsRequestSchema.parse(args);
}
