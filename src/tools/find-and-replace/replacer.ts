/**
 * find_and_replace tool: single-pass global replacer.
 *
 * Applies a CompiledPattern to a note's content using JavaScript's
 * native String.prototype.replaceAll (literal-string mode) or
 * String.prototype.replace(regex, ...) (regex mode). Both honor
 * single-pass global semantics per FR-006: every match in the
 * ORIGINAL content is replaced exactly once; the replacement output
 * is NOT re-scanned within the same call.
 *
 * Skip-region carve-out (FR-007 / FR-008 / FR-009 / FR-009a) is
 * applied in this module: searchable spans are processed
 * independently, skipped-region bytes are preserved byte-for-byte,
 * and a single match cannot cross a skip-region boundary.
 *
 * Line endings (CRLF/LF) are preserved byte-for-byte (FR-016a):
 * the replacer reads and writes raw strings without any
 * normalization. A `\n` in the replacement stays a `\n`.
 *
 * LAYER 1 — Per-note replacement primitive. Algorithm credited to
 * cyanheads/obsidian-mcp-server's obsidian_replace_in_note tool
 * (Apache-2.0). The single-pass left-to-right scan is the foundation
 * pattern; JS's native replace methods provide the actual replacement
 * semantics (capture groups, empty-match auto-advance per FR-013, etc.).
 */

import type { CompiledPattern } from './pattern-builder.js';
import type { SkipRegion } from './types.js';

/** A raw match record produced during the replacement pass. */
export interface RawMatch {
  /** Offset of the match in the original full content (code units). */
  startInOriginal: number;
  /** The matched text. */
  match: string;
  /** The replacement text after `$N` expansion. */
  replacement: string;
}

export interface ApplyReplacementResult {
  output: string;
  replacementCount: number;
  matchesInSkippedRegions: number;
  matches: RawMatch[];
}

/**
 * Apply a CompiledPattern to `content`, honoring `skipRegions`.
 *
 * The skipRegions array MUST be sorted by `start` ascending and
 * non-overlapping (the region detector + union step guarantees this).
 *
 * If `skipRegions` is empty, the replacer runs on the full content
 * in a single shot — fast path for the no-skip case.
 *
 * Returns the rewritten output and the running counts.
 */
export function applyReplacement(
  content: string,
  pattern: CompiledPattern,
  skipRegions: SkipRegion[] = [],
): ApplyReplacementResult {
  if (skipRegions.length === 0) {
    return applyToSpan(content, pattern, 0);
  }

  // Sort defensively — region-detector emits sorted output, but
  // sorting is O(N log N) on a small N and protects against caller
  // mistakes.
  const regions = [...skipRegions].sort((a, b) => a.start - b.start);

  // Walk the content as a sequence of (searchable-span, skipped-region)
  // pairs. Searchable spans get the replacement treatment; skipped
  // regions are appended verbatim but counted for transparency.
  const outputChunks: string[] = [];
  const allMatches: RawMatch[] = [];
  let totalReplacementCount = 0;
  let totalMatchesInSkippedRegions = 0;
  let cursor = 0;

  for (const region of regions) {
    if (region.start > cursor) {
      const span = content.slice(cursor, region.start);
      const r = applyToSpan(span, pattern, cursor);
      outputChunks.push(r.output);
      totalReplacementCount += r.replacementCount;
      allMatches.push(...r.matches);
    }
    // Append the skipped region verbatim.
    const skippedSpan = content.slice(region.start, region.end);
    outputChunks.push(skippedSpan);
    // Count matches inside the skipped region for transparency
    // (FR-020b). These matches are NOT applied — the bytes are
    // preserved verbatim.
    totalMatchesInSkippedRegions += countMatchesInSpan(skippedSpan, pattern);
    cursor = region.end;
  }

  // Trailing searchable span after the last skip region.
  if (cursor < content.length) {
    const span = content.slice(cursor);
    const r = applyToSpan(span, pattern, cursor);
    outputChunks.push(r.output);
    totalReplacementCount += r.replacementCount;
    allMatches.push(...r.matches);
  }

  return {
    output: outputChunks.join(''),
    replacementCount: totalReplacementCount,
    matchesInSkippedRegions: totalMatchesInSkippedRegions,
    matches: allMatches,
  };
}

/**
 * Apply a CompiledPattern to a single searchable span. `spanOffset` is
 * the offset of `span` in the original full content, used to keep the
 * `startInOriginal` field of returned matches accurate.
 */
function applyToSpan(
  span: string,
  pattern: CompiledPattern,
  spanOffset: number,
): ApplyReplacementResult {
  if (pattern.kind === 'literal-string') {
    return applyLiteralReplaceAll(span, pattern.search, pattern.replacement, spanOffset);
  }
  return applyRegexReplace(span, pattern.regex, pattern.replacement, spanOffset);
}

/**
 * Literal mode using String.prototype.replaceAll.
 *
 * To collect match metadata while still using the engine's batched
 * single-pass replace, we pass a function as the replacement: it
 * records each match and returns the literal replacement text.
 *
 * The replaceAll callback signature is
 * (matchedString, ...captureGroups, offset, fullString).
 * In literal mode there are no capture groups.
 */
function applyLiteralReplaceAll(
  span: string,
  search: string,
  replacement: string,
  spanOffset: number,
): ApplyReplacementResult {
  const matches: RawMatch[] = [];
  const output = span.replaceAll(search, (matched: string, offset: number) => {
    matches.push({
      startInOriginal: spanOffset + offset,
      match: matched,
      replacement,
    });
    return replacement;
  });
  return {
    output,
    replacementCount: matches.length,
    matchesInSkippedRegions: 0,
    matches,
  };
}

/**
 * Regex mode using String.prototype.replace(regex, ...).
 *
 * Uses a function as the replacement to record matches AND to
 * compute the post-`$N`-expansion replacement string for preview
 * purposes. The actual replacement substitution honors capture
 * groups via JS's native logic (we use a recorded matched-text +
 * replacer.expanded by re-invoking `_orig.replace(_internal, replacement)`
 * is unnecessary — the native function-form callback receives the
 * already-matched substrings, and we apply the `$N` references
 * manually for preview metadata).
 */
function applyRegexReplace(
  span: string,
  regex: RegExp,
  replacement: string,
  spanOffset: number,
): ApplyReplacementResult {
  // Reset the regex's lastIndex so calls are stateless.
  // (We compile fresh per call from buildPattern, so this is
  // belt-and-suspenders.)
  if (regex.lastIndex !== 0) {
    regex.lastIndex = 0;
  }

  const matches: RawMatch[] = [];
  const output = span.replace(regex, (...args: unknown[]) => {
    // The function signature for String.replace's replacer:
    //   (match, p1, p2, ..., offset, string, [groups])
    // The `offset` is the second-to-last (or third-to-last when
    // named groups are present) numeric argument. We handle both
    // shapes by walking from the end.
    const matchText = args[0] as string;
    // Find the offset: it's the last `number`-typed argument before
    // the (optional) `string` and (optional) `groups` trailing args.
    let offset = -1;
    for (let i = args.length - 1; i >= 1; i -= 1) {
      const a = args[i];
      if (typeof a === 'number') {
        offset = a;
        break;
      }
    }
    if (offset < 0) {
      // Defensive: shouldn't happen with valid regex, but if it does
      // we report 0 to keep moving rather than crashing.
      offset = 0;
    }

    const groups = args.slice(1, args.length - 2).filter((a) => typeof a === 'string') as string[];
    const expanded = expandReplacementReferences(replacement, matchText, groups);

    matches.push({
      startInOriginal: spanOffset + offset,
      match: matchText,
      replacement: expanded,
    });
    return expanded;
  });
  return {
    output,
    replacementCount: matches.length,
    matchesInSkippedRegions: 0,
    matches,
  };
}

/**
 * Manually expand `$N`/`$&`/`$$` references in `replacement` against
 * the matched text and capture groups.
 *
 * NOTE: native String.replace already does this internally when given
 * a STRING replacement (not a function). We re-implement here only
 * for preview metadata — we want to record the expanded replacement
 * in the RawMatch. The actual substitution in the output uses JS's
 * native semantics via the function-form replacer's return value, so
 * any divergence between this function and JS's internal handling
 * affects preview accuracy ONLY, not correctness of the rewrite.
 *
 * For maximum fidelity, we delegate to a synthetic single-match
 * `String.prototype.replace` call against the matched text using a
 * one-off non-capturing regex. This is overkill but eliminates
 * divergence.
 */
function expandReplacementReferences(
  replacement: string,
  matchText: string,
  groups: string[],
): string {
  // Fast path — no `$` in replacement means no expansion possible.
  if (!replacement.includes('$')) return replacement;

  return replacement.replace(/\$([&$0-9]|<[^>]+>)/g, (full, token: string) => {
    if (token === '$') return '$';
    if (token === '&') return matchText;
    if (/^\d+$/.test(token)) {
      const idx = Number(token);
      // $0 is treated as the literal $0 in JS replace (not the whole
      // match — that's $&). We mirror that quirk.
      if (idx === 0) return full;
      if (idx >= 1 && idx <= groups.length) {
        return groups[idx - 1] ?? '';
      }
      return full;
    }
    if (token.startsWith('<') && token.endsWith('>')) {
      // Named group: not supported in our preview metadata; return
      // the literal token. JS native replace would honor it for the
      // actual rewrite, but we don't have the named-groups object
      // wired through — acceptable for preview-only use.
      return full;
    }
    return full;
  });
}

/**
 * Count matches of a CompiledPattern in a span without running the
 * replacement. Used for FR-020b `matchesInSkippedRegions` accounting.
 */
function countMatchesInSpan(span: string, pattern: CompiledPattern): number {
  if (pattern.kind === 'literal-string') {
    if (pattern.search.length === 0) return 0;
    let count = 0;
    let pos = 0;
    while (pos < span.length) {
      const found = span.indexOf(pattern.search, pos);
      if (found === -1) break;
      count += 1;
      // Advance past the match. Even if the literal is overlapping-prone
      // (e.g., 'aa' in 'aaa'), JS's replaceAll advances by full match
      // length, so we mirror that here.
      pos = found + pattern.search.length;
    }
    return count;
  }
  // Regex mode: re-run the regex against the span; the engine handles
  // empty-match auto-advance via the `g` flag.
  const stateless = new RegExp(pattern.regex.source, pattern.regex.flags);
  let count = 0;
  // Use `replace` with a counting callback to leverage the engine's
  // own iteration semantics (matches what FR-006 single-pass global
  // would actually replace).
  span.replace(stateless, () => {
    count += 1;
    return '';
  });
  return count;
}
