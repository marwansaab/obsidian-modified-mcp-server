/**
 * Surgical-read tools: input schemas and asserters.
 *
 * Single source of truth for both runtime validation and the MCP
 * `inputSchema` (the latter is derived via `zod-to-json-schema` in
 * `./tool.ts`). The heading-path predicate is imported from
 * `../patch-content/schema.ts` so there is exactly one definition of
 * the rule across the whole repo (FR-003 / ADR-001 — see
 * specs/003-surgical-reads/research.md R2).
 */

import { z } from 'zod';

import { isValidHeadingPath } from '../patch-content/schema.js';

const HEADING_RULE = 'heading targets must use the full H1::H2[::H3...] path';

export const GetHeadingContentsRequestSchema = z.object({
  filepath: z
    .string()
    .min(1, 'filepath must be a non-empty string')
    .describe('Path to the file (relative to vault root).'),
  heading: z
    .string()
    .min(1, 'heading must be a non-empty string')
    .describe(
      "Full heading path: at least two non-empty segments separated by '::' (i.e., the H1::H2[::H3...] form). Top-level headings and headings whose literal text contains '::' are unreachable through this tool — fall back to get_file_contents for those cases."
    ),
  vaultId: z
    .string()
    .optional()
    .describe('Optional vault ID (defaults to configured default vault).'),
});

export type GetHeadingContentsRequest = z.infer<typeof GetHeadingContentsRequestSchema>;

/**
 * Wrapper-boundary validator for `get_heading_contents`. Throws on every
 * invalid input:
 *
 * 1. Type / shape failures from `.parse` propagate unchanged — `ZodError`'s
 *    message preserves the offending field paths (Constitution III).
 * 2. Heading-target structural failures throw an `Error` whose message
 *    contains: the rule name, `received: "<offending value>"`, and
 *    `e.g., "<corrected example>"` — same three-substring contract as
 *    `patch_content`'s heading rejection (FR-004 must-match).
 */
export function assertValidGetHeadingContentsRequest(
  args: unknown
): GetHeadingContentsRequest {
  const req = GetHeadingContentsRequestSchema.parse(args);
  if (!isValidHeadingPath(req.heading)) {
    throw new Error(
      `${HEADING_RULE} — received: "${req.heading}" — e.g., "<Parent Heading>::${
        req.heading.length === 0 || req.heading.trim().length === 0
          ? '<Sub Heading>'
          : req.heading.replace(/::/g, ' ')
      }"`
    );
  }
  return req;
}

export const GetFrontmatterFieldRequestSchema = z.object({
  filepath: z
    .string()
    .min(1, 'filepath must be a non-empty string')
    .describe('Path to the file (relative to vault root).'),
  field: z
    .string()
    .min(1, 'field must be a non-empty string')
    .refine((s) => s.trim().length > 0, {
      message: 'field must not be whitespace-only',
    })
    .describe(
      'The name of the single frontmatter field to read. Must be non-empty after trimming whitespace.'
    ),
  vaultId: z
    .string()
    .optional()
    .describe('Optional vault ID (defaults to configured default vault).'),
});

export type GetFrontmatterFieldRequest = z.infer<typeof GetFrontmatterFieldRequestSchema>;

/**
 * Wrapper-boundary validator for `get_frontmatter_field`. The only
 * rejection paths are zod's own (missing/wrong-type/empty/whitespace
 * field), so `ZodError`'s standard message — which names the failing
 * field path — is the wrapper-side error format.
 */
export function assertValidGetFrontmatterFieldRequest(
  args: unknown
): GetFrontmatterFieldRequest {
  return GetFrontmatterFieldRequestSchema.parse(args);
}
