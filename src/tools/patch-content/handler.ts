/**
 * patch_content tool: MCP handler. Thin wrapper around
 * ObsidianRestService.patchContent — validates inputs at the boundary
 * (FR-008), forwards to the upstream Local REST API plugin's
 * PATCH /vault/{path} endpoint with the documented headers (FR-005),
 * and lets upstream errors propagate (Constitution Principle IV).
 */

import { assertValidPatchRequest } from './schema.js';

import type { ObsidianRestService } from '../../services/obsidian-rest.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export async function handlePatchContent(
  args: Record<string, unknown>,
  rest: ObsidianRestService
): Promise<CallToolResult> {
  const req = assertValidPatchRequest(args);
  await rest.patchContent(
    req.filepath,
    req.operation,
    req.targetType,
    req.target,
    req.content
  );
  return {
    content: [{ type: 'text', text: 'Content patched successfully' }],
  };
}
