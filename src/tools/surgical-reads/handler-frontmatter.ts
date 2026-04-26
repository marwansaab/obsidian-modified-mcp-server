/**
 * get_frontmatter_field tool: MCP handler. Thin wrapper around
 * ObsidianRestService.getFrontmatterField — validates inputs at the
 * boundary (FR-010), forwards to the upstream Local REST API plugin's
 * GET /vault/{path}/frontmatter/{field} endpoint (FR-008), decodes the
 * upstream JSON envelope, and surfaces the typed value on the MCP
 * output's `value` field with its original frontmatter type preserved
 * (string, number, boolean, array, object, or null). Upstream errors
 * propagate (Constitution Principle IV); a present-but-null value is
 * distinct from a missing-field 4xx.
 */

import { assertValidGetFrontmatterFieldRequest } from './schema.js';

import type { ObsidianRestService } from '../../services/obsidian-rest.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export async function handleGetFrontmatterField(
  args: Record<string, unknown>,
  rest: ObsidianRestService
): Promise<CallToolResult> {
  const req = assertValidGetFrontmatterFieldRequest(args);
  const value = await rest.getFrontmatterField(req.filepath, req.field);
  return {
    content: [{ type: 'text', text: JSON.stringify({ value }) }],
  };
}
