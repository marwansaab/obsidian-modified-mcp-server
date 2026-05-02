/**
 * rename_file tool: input schema (zod) + boundary validator.
 *
 * Single source of truth for both the runtime parser and the published
 * MCP `inputSchema` (the latter is derived via `zod-to-json-schema` in
 * `./tool.ts`). See specs/012-safe-rename/data-model.md and
 * contracts/rename_file.md for the authoritative definitions.
 */

import { z } from 'zod';

export const RenameFileRequestSchema = z.object({
  old_path: z
    .string()
    .trim()
    .min(1, 'old_path is required')
    .describe('Vault-relative path to the file (markdown note or attachment) to rename.'),
  new_path: z
    .string()
    .trim()
    .min(1, 'new_path is required')
    .describe('Vault-relative destination path. The parent folder must already exist.'),
  vaultId: z
    .string()
    .trim()
    .optional()
    .describe('Optional vault ID (defaults to configured default vault).'),
});

export type RenameFileRequest = z.infer<typeof RenameFileRequestSchema>;

export function assertValidRenameFileRequest(args: unknown): RenameFileRequest {
  return RenameFileRequestSchema.parse(args);
}
