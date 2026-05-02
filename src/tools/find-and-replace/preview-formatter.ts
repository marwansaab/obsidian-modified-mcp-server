/**
 * find_and_replace tool: preview formatter.
 *
 * Builds the structured per-match preview objects returned by the
 * dry-run path (FR-015). Each match preview is
 *   { matchIndex, lineNumber, columnStart, before, match, replacement, after }
 * with `before` and `after` truncated to 40 Unicode code points
 * (R9 — truncation by code points, not bytes / not code units).
 *
 * Newlines inside the context are preserved literally so the user
 * sees line context in the preview (FR-015).
 *
 * LAYER 2 — Vault-wide composition + dry-run. Pattern credited to
 * blacksmithers/vaultforge's grep-sub tool (MIT). The exact preview
 * shape is this project's structured-match design (Q1 / session 4),
 * but the dry-run-with-preview concept comes from vaultforge.
 */

import type { RawMatch } from './replacer.js';
import type { MatchPreview } from './types.js';

const DEFAULT_MAX_PREVIEWS = 3;
const DEFAULT_MAX_CONTEXT_CODE_POINTS = 40;

/**
 * Compute the (1-based) line number AND (1-based) column of a given
 * code-unit offset in `content`. Counts both `\n` and `\r\n` as a
 * single line break (line counts agree with what users see in their
 * editor, FR-016a-friendly).
 */
function locate(content: string, offset: number): { lineNumber: number; columnStart: number } {
  // Walk from the start; for very large files this is O(N), but
  // matches are typically a small number per file and we only call
  // this for the first N preview matches (default 3).
  let lineNumber = 1;
  let lastLineStart = 0;
  for (let i = 0; i < offset && i < content.length; i += 1) {
    const c = content[i];
    if (c === '\n') {
      lineNumber += 1;
      lastLineStart = i + 1;
    } else if (c === '\r') {
      // Treat \r\n as one line break; `\r` alone (old Mac) also
      // counts. If the next char is `\n`, advance i to consume it.
      lineNumber += 1;
      lastLineStart = content[i + 1] === '\n' ? i + 2 : i + 1;
      if (content[i + 1] === '\n') {
        i += 1;
      }
    }
  }
  // The column is in code-unit space measured from the line start.
  const columnStart = offset - lastLineStart + 1;
  return { lineNumber, columnStart };
}

/**
 * Slice up to `maxCodePoints` code points from the END of `s`. Used
 * for the `before` context (left of the match).
 */
function takeLastCodePoints(s: string, maxCodePoints: number): string {
  if (s.length === 0 || maxCodePoints <= 0) return '';
  const codePoints = Array.from(s);
  if (codePoints.length <= maxCodePoints) return s;
  return codePoints.slice(-maxCodePoints).join('');
}

/**
 * Slice up to `maxCodePoints` code points from the START of `s`.
 * Used for the `after` context (right of the match).
 */
function takeFirstCodePoints(s: string, maxCodePoints: number): string {
  if (s.length === 0 || maxCodePoints <= 0) return '';
  const codePoints = Array.from(s);
  if (codePoints.length <= maxCodePoints) return s;
  return codePoints.slice(0, maxCodePoints).join('');
}

interface BuildPreviewsOptions {
  maxPreviews?: number;
  maxContextCodePoints?: number;
}

/**
 * Build up to `maxPreviews` MatchPreview entries from raw matches
 * recorded during the replacement pass. Returns an empty array if
 * `matches` is empty.
 */
export function buildPreviews(
  matches: RawMatch[],
  content: string,
  opts: BuildPreviewsOptions = {},
): MatchPreview[] {
  const maxPreviews = opts.maxPreviews ?? DEFAULT_MAX_PREVIEWS;
  const maxCtx = opts.maxContextCodePoints ?? DEFAULT_MAX_CONTEXT_CODE_POINTS;

  if (matches.length === 0 || maxPreviews <= 0) return [];

  const out: MatchPreview[] = [];
  const limit = Math.min(matches.length, maxPreviews);
  for (let i = 0; i < limit; i += 1) {
    const m = matches[i]!;
    const matchEnd = m.startInOriginal + m.match.length;
    const beforeFull = content.slice(0, m.startInOriginal);
    const afterFull = content.slice(matchEnd);
    const { lineNumber, columnStart } = locate(content, m.startInOriginal);
    out.push({
      matchIndex: i + 1,
      lineNumber,
      columnStart,
      before: takeLastCodePoints(beforeFull, maxCtx),
      match: m.match,
      replacement: m.replacement,
      after: takeFirstCodePoints(afterFull, maxCtx),
    });
  }
  return out;
}

export const __testing = {
  locate,
  takeLastCodePoints,
  takeFirstCodePoints,
};
