/**
 * find_and_replace tool: skip-region detector.
 *
 * Two independent detectors (FR-009 — independent + union):
 *   1. detectFencedCodeBlocks — CommonMark line-anchored fences
 *      (FR-007). Opener: `^ {0,3}\`{3,}.*$`. Closer: line at
 *      line-start with at least the same number of backticks.
 *      Tilde fences (`~~~`) are NOT honored (out of scope).
 *      Unclosed fence runs to end-of-file.
 *   2. detectHtmlComments — non-greedy `<!--…-->` spanning newlines
 *      (FR-008). The first `-->` closes the comment per HTML spec.
 *      Empty comments (`<!---->`, `<!-- -->`) are honored. Unclosed
 *      `<!--` runs to end-of-file.
 *
 * detectAllSkipRegions composes the two via union per FR-009/FR-009a.
 *
 * LAYER 2 — Vault-wide composition + dry-run. Region-detection
 * variant is this project's own implementation, but the broader
 * dry-run / vault-walk strategy this module supports is credited to
 * blacksmithers/vaultforge's grep-sub tool (MIT).
 */

import type { SkipRegion } from './types.js';

/**
 * Detect fenced code block ranges in `content`. Returns ranges in
 * code-unit coordinates, sorted by `start` ascending, non-overlapping.
 * Each range covers from the start of the opener line to the end of
 * the closer line (or end-of-file for unclosed fences) — i.e., the
 * fence lines themselves are part of the protected region.
 */
export function detectFencedCodeBlocks(content: string): SkipRegion[] {
  const regions: SkipRegion[] = [];
  // Walk line by line. We keep track of code-unit positions of each
  // line start so we can produce accurate offsets without splitting
  // the string twice.
  const lines = content.split('\n');
  // Re-derive each line's start position. An array `lineStarts[i]` is
  // the offset of the first character of line i in the original
  // content. Account for the `\n` consumed by split.
  const lineStarts: number[] = [];
  let pos = 0;
  for (const line of lines) {
    lineStarts.push(pos);
    pos += line.length + 1; // +1 for the \n we split on
  }

  let i = 0;
  while (i < lines.length) {
    const opener = matchFenceOpener(lines[i]!);
    if (opener === null) {
      i += 1;
      continue;
    }

    const start = lineStarts[i]!;
    const fenceLength = opener.fenceLength;

    // Search subsequent lines for a matching closer.
    let closeLine = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (matchFenceCloser(lines[j]!, fenceLength)) {
        closeLine = j;
        break;
      }
    }

    if (closeLine === -1) {
      // Unclosed fence: protect from opener line through end of file.
      regions.push({ start, end: content.length, kind: 'code-block' });
      break;
    }

    // Compute end-of-closer-line position. The closer line ends at
    // lineStarts[closeLine] + lines[closeLine].length. If a `\n`
    // follows that position, include it so the protected region ends
    // at the natural line boundary.
    const closerLineEnd = lineStarts[closeLine]! + lines[closeLine]!.length;
    const endIncludingNewline =
      closerLineEnd < content.length && content[closerLineEnd] === '\n'
        ? closerLineEnd + 1
        : closerLineEnd;

    regions.push({ start, end: endIncludingNewline, kind: 'code-block' });

    i = closeLine + 1;
  }

  return regions;
}

/**
 * Match a CommonMark fence opener:
 *   ^ {0,3}` {3,}.*$
 * Excluding the trailing `\r` if the original line had CRLF.
 *
 * Returns the fenceLength (count of backticks) on a match, or null.
 */
function matchFenceOpener(line: string): { fenceLength: number; leadingSpaces: number } | null {
  // Strip trailing \r so CRLF-line content matches the same way.
  const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
  const match = /^( {0,3})(`{3,})/.exec(trimmed);
  if (!match) return null;
  return {
    fenceLength: match[2]!.length,
    leadingSpaces: match[1]!.length,
  };
}

/**
 * Match a CommonMark fence closer: line containing only backticks
 * (≥ openerCount), with up to 3 leading spaces and optional trailing
 * whitespace. Per CommonMark, the closer line MUST NOT have any text
 * after the backticks (info string is not allowed on the closer).
 */
function matchFenceCloser(line: string, openerCount: number): boolean {
  const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
  const match = /^( {0,3})(`{3,})\s*$/.exec(trimmed);
  if (!match) return false;
  return match[2]!.length >= openerCount;
}

/**
 * Detect HTML comment ranges in `content`. Returns ranges in
 * code-unit coordinates, sorted by `start` ascending, non-overlapping.
 *
 * Region-detector uses dotall semantics (matches across newlines)
 * regardless of FR-013's flag set — region detection is independent
 * of the user's search regex.
 */
export function detectHtmlComments(content: string): SkipRegion[] {
  const regions: SkipRegion[] = [];
  let i = 0;
  while (i < content.length) {
    const openIdx = content.indexOf('<!--', i);
    if (openIdx === -1) break;
    const closeIdx = content.indexOf('-->', openIdx + 4);
    if (closeIdx === -1) {
      // Unclosed comment runs to EOF.
      regions.push({ start: openIdx, end: content.length, kind: 'html-comment' });
      break;
    }
    const end = closeIdx + 3; // include the '-->' itself
    regions.push({ start: openIdx, end, kind: 'html-comment' });
    i = end;
  }
  return regions;
}

/**
 * Detect all skip regions per the active flags, then take the UNION
 * of the byte ranges (FR-009 — independent detection + union).
 *
 * The two detectors run independently against the original content;
 * neither sees the other's output. The union step merges any
 * overlapping or adjacent ranges into a single contiguous range.
 *
 * Output: ranges sorted by `start` ascending, non-overlapping.
 */
export function detectAllSkipRegions(
  content: string,
  opts: { skipCodeBlocks: boolean; skipHtmlComments: boolean },
): SkipRegion[] {
  const fences = opts.skipCodeBlocks ? detectFencedCodeBlocks(content) : [];
  const comments = opts.skipHtmlComments ? detectHtmlComments(content) : [];
  if (fences.length === 0 && comments.length === 0) return [];
  if (fences.length === 0) return comments;
  if (comments.length === 0) return fences;
  return mergeRegions([...fences, ...comments]);
}

/**
 * Merge a set of regions: sort by `start` ascending, then walk and
 * merge any overlapping or adjacent ranges. The `kind` of the
 * earlier region wins on merge (per data-model.md §2 invariant).
 */
function mergeRegions(regions: SkipRegion[]): SkipRegion[] {
  if (regions.length === 0) return [];
  const sorted = [...regions].sort((a, b) => a.start - b.start);
  const out: SkipRegion[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i += 1) {
    const cur = sorted[i]!;
    const prev = out[out.length - 1]!;
    if (cur.start <= prev.end) {
      // Overlap or adjacent: extend prev.end if cur extends further.
      if (cur.end > prev.end) {
        prev.end = cur.end;
      }
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

export const __testing = {
  matchFenceOpener,
  matchFenceCloser,
  mergeRegions,
};
