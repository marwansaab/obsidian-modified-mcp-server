/**
 * delete_file tool: input schema (zod) + boundary validator.
 *
 * Single source of truth for both the runtime parser and the published
 * MCP `inputSchema` (the latter is derived via `zod-to-json-schema` in
 * `./tool.ts`). See specs/005-fix-directory-delete/data-model.md and
 * contracts/delete_file.md for the authoritative definitions.
 */

import { z } from 'zod';

export const DeleteFileRequestSchema = z.object({
  filepath: z
    .string()
    .trim()
    .min(1, 'filepath is required')
    .describe(
      'Path to the file or directory to delete (relative to vault root). Directories are deleted recursively.'
    ),
  vaultId: z
    .string()
    .trim()
    .optional()
    .describe('Optional vault ID (defaults to configured default vault).'),
});

export type DeleteFileRequest = z.infer<typeof DeleteFileRequestSchema>;

export function assertValidDeleteFileRequest(args: unknown): DeleteFileRequest {
  return DeleteFileRequestSchema.parse(args);
}
