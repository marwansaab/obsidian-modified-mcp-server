/**
 * patch_content tool: input schema and heading-path validator.
 *
 * Single source of truth for both the runtime validator and the MCP
 * `inputSchema` (the latter is derived via `zod-to-json-schema` in
 * `./tool.ts`). See specs/001-reenable-patch-content/data-model.md and
 * contracts/patch_content.md for the authoritative definitions.
 */

import { z } from 'zod';

export const PatchRequestSchema = z.object({
  filepath: z
    .string()
    .min(1, 'filepath must be a non-empty string')
    .describe('Path to the file (relative to vault root).'),
  operation: z
    .enum(['append', 'prepend', 'replace'])
    .describe('How to insert the content relative to the target.'),
  targetType: z
    .enum(['heading', 'block', 'frontmatter'])
    .describe('Type of target to locate.'),
  target: z
    .string()
    .min(1, 'target must be a non-empty string')
    .describe(
      "When targetType is 'heading', the value MUST be a full path: at least two non-empty segments separated by '::'. Top-level headings and headings whose literal text contains '::' are unreachable through this tool."
    ),
  content: z.string().describe('The markdown content to insert.'),
  vaultId: z
    .string()
    .optional()
    .describe('Optional vault ID (defaults to configured default vault).'),
});

export type PatchRequest = z.infer<typeof PatchRequestSchema>;

const HEADING_RULE = 'heading targets must use the full H1::H2[::H3...] path';

/**
 * Pure structural predicate. Does NOT consult the note, does NOT trim,
 * does NOT decode escapes. Returns true iff the value splits into two
 * or more non-empty segments on `::`.
 */
export function isValidHeadingPath(target: string): boolean {
  const segments = target.split('::');
  if (segments.length < 2) return false;
  for (const segment of segments) {
    if (segment.length === 0) return false;
  }
  return true;
}

/**
 * Wrapper-boundary validator. Throws on every invalid input:
 *
 * 1. Type / shape failures from `PatchRequestSchema.parse` propagate
 *    unchanged — `ZodError`'s message preserves the offending field
 *    paths, satisfying Constitution Principle III's
 *    "field paths reported by zod" requirement.
 * 2. Heading-target structural failures throw an `Error` whose message
 *    contains: the rule name, `received: "<offending value>"`, and
 *    `e.g., "<corrected example>"` — together satisfying SC-004.
 *
 * Non-heading target types skip the structural check (see FR-006).
 */
export function assertValidPatchRequest(args: unknown): PatchRequest {
  const req = PatchRequestSchema.parse(args);
  if (req.targetType === 'heading' && !isValidHeadingPath(req.target)) {
    throw new Error(
      `${HEADING_RULE} — received: "${req.target}" — e.g., "<Parent Heading>::${
        req.target.length === 0 || req.target.trim().length === 0
          ? '<Sub Heading>'
          : req.target.replace(/::/g, ' ')
      }"`
    );
  }
  return req;
}
