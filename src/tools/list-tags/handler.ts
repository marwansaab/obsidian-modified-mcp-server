/**
 * list_tags MCP tool handler.
 *
 * Calls `ObsidianRestService.listTags()` and forwards the upstream's
 * response body to the caller verbatim, JSON-stringified into a single
 * `text` content block (spec 008 FR-012). Validation, transport, and
 * typed-error semantics inherit from the surrounding patterns:
 *
 *   1. Boundary validation via the zod schema (Constitution Principle III).
 *   2. Typed upstream errors (`ObsidianApiError` / `ObsidianTimeoutError` /
 *      `ObsidianNotFoundError`) propagate unchanged; the dispatcher's outer
 *      try/catch in `src/index.ts` wraps them into the MCP
 *      `{content, isError: true}` shape, so callers see the upstream
 *      status and message verbatim (spec 008 FR-007, Principle IV).
 *   3. zod validation failures are caught here and re-thrown as plain
 *      `Error`s with the field path inlined into the message — same
 *      shape used by `src/tools/delete-file/handler.ts`.
 */

import { z } from 'zod';

import { assertValidListTagsRequest } from './schema.js';
import { ObsidianRestService } from '../../services/obsidian-rest.js';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export async function handleListTags(
  args: unknown,
  rest: ObsidianRestService
): Promise<CallToolResult> {
  try {
    assertValidListTagsRequest(args);
    const body = await rest.listTags();
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(body, null, 2),
        },
      ],
    };
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issue = err.issues[0];
      const path = issue?.path.join('.') ?? '';
      throw new Error(`Invalid input — ${path}: ${issue?.message ?? 'invalid'}`);
    }
    throw err;
  }
}
