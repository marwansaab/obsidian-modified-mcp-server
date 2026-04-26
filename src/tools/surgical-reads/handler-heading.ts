/**
 * get_heading_contents tool: MCP handler. Thin wrapper around
 * ObsidianRestService.getHeadingContents — validates inputs at the
 * boundary (FR-010), forwards to the upstream Local REST API plugin's
 * GET /vault/{path}/heading/{path-segments} endpoint with
 * Accept: text/markdown (FR-005), and lets upstream errors propagate
 * (Constitution Principle IV).
 */

import { assertValidGetHeadingContentsRequest } from './schema.js';

import type { ObsidianRestService } from '../../services/obsidian-rest.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export async function handleGetHeadingContents(
  args: Record<string, unknown>,
  rest: ObsidianRestService
): Promise<CallToolResult> {
  const req = assertValidGetHeadingContentsRequest(args);
  const body = await rest.getHeadingContents(req.filepath, req.heading);
  return {
    content: [{ type: 'text', text: body }],
  };
}
