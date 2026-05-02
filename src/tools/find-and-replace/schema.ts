/**
 * find_and_replace tool: input schema (zod) + boundary validator.
 *
 * Single source of truth for both the runtime parser and the published
 * MCP `inputSchema` (the latter is derived via `zod-to-json-schema` in
 * `./tool.ts`). See specs/013-find-and-replace/data-model.md §1 and
 * specs/013-find-and-replace/contracts/find_and_replace.md for the
 * authoritative definitions.
 *
 * LAYER 3 — Multi-vault dispatch wrapper. Original contribution of this
 * project; the regex-flag set used in the boundary's compile check
 * (`gimu`, FR-013) is the same set the runtime helper uses, so a
 * pattern that compiles at the boundary is guaranteed to compile in
 * the helper.
 */

import { z } from 'zod';

/**
 * The flag set used by FR-013 always-on bits, used both by the
 * boundary's regex-compile precheck (FR-023) and the runtime helper:
 *   g — global match (FR-006)
 *   i — case-insensitive (added at runtime when `caseSensitive: false`)
 *   m — multiline (^/$ match line boundaries)
 *   u — Unicode mode (required for FR-012 case-folding)
 */
const FR013_BOUNDARY_FLAGS = 'gimu';

export const FindAndReplaceRequestSchema = z
  .object({
    search: z
      .string()
      .min(1, 'search must be non-empty')
      .describe('The literal text or regex pattern to match. Required, non-empty.'),
    replacement: z
      .string()
      .describe(
        'The replacement text. Honors $1 / $& / etc. capture-group references when regex mode is on.',
      ),
    regex: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'When true, `search` is parsed as an ECMAScript regex with flags g+i?+m+u (no s).',
      ),
    caseSensitive: z
      .boolean()
      .optional()
      .default(true)
      .describe('When false, matching is case-insensitive (ECMAScript Unicode case-folding).'),
    wholeWord: z
      .boolean()
      .optional()
      .default(false)
      .describe('When true, wraps the effective pattern in \\b…\\b (literal and regex modes).'),
    flexibleWhitespace: z
      .boolean()
      .optional()
      .default(false)
      .describe('When true, substitutes any whitespace run in `search` with \\s+.'),
    skipCodeBlocks: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'When true, fenced code blocks (CommonMark line-anchored, triple-backtick) are excluded from the search and preserved byte-for-byte.',
      ),
    skipHtmlComments: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'When true, HTML comments (<!-- … -->) are excluded from the search and preserved byte-for-byte. Critical for preserving audit-trail comments during project-name renames.',
      ),
    dryRun: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'When true, no writes; the response includes structured per-match previews instead.',
      ),
    pathPrefix: z
      .string()
      .optional()
      .describe(
        'If set, only files under this vault-relative path-prefix are scoped. Directory-segment match, case-sensitive on all platforms (including Windows), no glob expansion. Trailing slash is normalized away.',
      ),
    vaultId: z
      .string()
      .optional()
      .describe('Optional vault ID (defaults to configured default vault).'),
    verbose: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        'When true, the response includes the per-file array. Default false to keep responses bounded for large vaults.',
      ),
  })
  .superRefine((value, ctx) => {
    if (value.regex) {
      try {
        // Pre-compile under the always-on flag set to surface FR-023
        // errors at the boundary, with a precise field path.
         
        new RegExp(value.search, FR013_BOUNDARY_FLAGS);
      } catch (err) {
        const message =
          err instanceof Error
            ? `Invalid regex: ${err.message}`
            : 'Invalid regex: unknown compile error';
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['search'],
          message,
        });
      }
    }
  });

export type FindAndReplaceRequest = z.infer<typeof FindAndReplaceRequestSchema>;

/**
 * Boundary validator. Throws a `z.ZodError` with field paths on failure.
 * The handler converts that to a structured MCP error per Principle IV.
 */
export function assertValidFindAndReplaceRequest(args: unknown): FindAndReplaceRequest {
  return FindAndReplaceRequestSchema.parse(args);
}
