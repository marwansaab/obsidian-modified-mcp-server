/**
 * find_and_replace tool: MCP handler.
 *
 * Thin LAYER 3 wrapper:
 *   1. Validates the boundary inputs via zod (Principle III).
 *   2. Strips `vaultId` from the validated request (the per-vault
 *      routing has already happened in the dispatcher).
 *   3. Delegates to `rest.findAndReplace(opts)` — the workhorse on
 *      the per-vault REST service instance.
 *   4. Wraps the result in a `CallToolResult` text payload.
 *
 * The `resolvedVaultId` parameter comes from the dispatcher's
 * `resolveVaultId(args)` and lands in the response's `vaultId` field
 * via the helper.
 */

import { z } from 'zod';

import { assertValidFindAndReplaceRequest } from './schema.js';
import { ObsidianRestService } from '../../services/obsidian-rest.js';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export async function handleFindAndReplace(
  args: unknown,
  rest: ObsidianRestService,
  resolvedVaultId: string,
): Promise<CallToolResult> {
  try {
    const req = assertValidFindAndReplaceRequest(args);
    // Drop `vaultId` from the helper opts — the dispatcher has already
    // resolved it; the helper boundary is vault-agnostic per R8.
    const result = await rest.findAndReplace({
      search: req.search,
      replacement: req.replacement,
      regex: req.regex,
      caseSensitive: req.caseSensitive,
      wholeWord: req.wholeWord,
      flexibleWhitespace: req.flexibleWhitespace,
      skipCodeBlocks: req.skipCodeBlocks,
      skipHtmlComments: req.skipHtmlComments,
      dryRun: req.dryRun,
      pathPrefix: req.pathPrefix,
      verbose: req.verbose,
    });
    // Override the result's vaultId with the dispatcher-resolved id
    // so the response always echoes the dispatcher's view (works
    // identically for default-vault and explicit-vaultId calls).
    const echoedResult = { ...result, vaultId: resolvedVaultId };
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(echoedResult, null, 2),
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
