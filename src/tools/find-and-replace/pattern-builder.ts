/**
 * find_and_replace tool: pattern builder.
 *
 * Compiles the user's `search` (literal or regex) into a callable
 * pattern object that the replacer consumes. Honors `caseSensitive`,
 * `wholeWord`, `flexibleWhitespace`, and `regex` flags per FR-010 /
 * FR-011 / FR-012 / FR-013.
 *
 * For pure literal mode (no caseSensitive override, no wholeWord,
 * no flexibleWhitespace), the builder signals that callers can use
 * String.prototype.replaceAll directly — saving a regex compile.
 * For all other cases, the literal source is escaped first then
 * compiled to a RegExp with the FR-013 flag set.
 *
 * LAYER 1 — Per-note replacement primitive. Algorithm credited to
 * cyanheads/obsidian-mcp-server's obsidian_replace_in_note tool
 * (Apache-2.0). The escape function and pattern-construction shape
 * follow that project's pattern; capture-group handling and the JS
 * native String.prototype.replace semantics provide the actual
 * replacement work (FR-006, FR-013).
 */

/**
 * Escape regex metacharacters in a literal string so it can be safely
 * substituted into a regex template. Required for FR-014 correctness
 * with arbitrary user-provided literal strings.
 *
 * Implementation borrowed from common JS practice and used elsewhere in
 * this codebase (see src/tools/rename-file/regex-passes.ts).
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A compiled pattern descriptor produced by `buildPattern`. */
export type CompiledPattern =
  | {
      /** Pure literal mode — caller can use String.prototype.replaceAll. */
      kind: 'literal-string';
      search: string;
      replacement: string;
    }
  | {
      /** Regex-backed pattern — caller uses String.prototype.replace(regex, ...). */
      kind: 'regex';
      regex: RegExp;
      replacement: string;
    };

interface BuildPatternInput {
  search: string;
  replacement: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  flexibleWhitespace: boolean;
}

/**
 * Compute the regex flag string per FR-013.
 *   g — always (FR-006 single-pass global)
 *   i — when caseSensitive: false (FR-012)
 *   m — always (multiline anchors)
 *   u — always (Unicode case-folding for FR-012)
 *   s — never (dotall disabled)
 */
function buildFlags(caseSensitive: boolean): string {
  return caseSensitive ? 'gmu' : 'gimu';
}

/**
 * Apply `flexibleWhitespace` to a regex source: every run of one or
 * more whitespace characters in the source is replaced by `\s+`.
 * (FR-011, regex mode.)
 */
function applyFlexibleWhitespace(regexSource: string): string {
  return regexSource.replace(/\s+/g, '\\s+');
}

/**
 * Apply `flexibleWhitespace` to an escaped literal: same as the regex
 * version, but operates on the escaped output. Whitespace characters
 * are not regex metacharacters so they survive escapeRegex unchanged.
 * (FR-011, literal mode.)
 */
function applyFlexibleWhitespaceLiteral(escapedSource: string): string {
  return escapedSource.replace(/\s+/g, '\\s+');
}

/**
 * Wrap a regex source in `\b…\b` for whole-word matching. Used in
 * both literal and regex modes (FR-010). The wrapper uses a
 * non-capturing group so it doesn't perturb the user's capture-group
 * indices in regex mode.
 */
function wrapWholeWord(regexSource: string): string {
  return `\\b(?:${regexSource})\\b`;
}

/**
 * Build a CompiledPattern from a request. Throws on regex compile
 * error — though the boundary already caught that case via the schema's
 * superRefine (FR-023). The throw here is the helper-layer backstop so
 * direct callers (012's rename_file handler) cannot bypass FR-023.
 */
export function buildPattern(input: BuildPatternInput): CompiledPattern {
  const { search, replacement, regex, caseSensitive, wholeWord, flexibleWhitespace } = input;

  // Pure literal fast path: no flag adjustments, no transformation
  // needed — let the caller use String.prototype.replaceAll directly.
  if (!regex && caseSensitive && !wholeWord && !flexibleWhitespace) {
    return { kind: 'literal-string', search, replacement };
  }

  let regexSource: string;
  if (regex) {
    // User-provided regex source. Apply flexibleWhitespace BEFORE
    // wholeWord so the \b anchors wrap the full transformed pattern.
    regexSource = flexibleWhitespace ? applyFlexibleWhitespace(search) : search;
  } else {
    // Literal source — escape metacharacters first, then optionally
    // apply flexibleWhitespace.
    const escaped = escapeRegex(search);
    regexSource = flexibleWhitespace ? applyFlexibleWhitespaceLiteral(escaped) : escaped;
  }

  if (wholeWord) {
    regexSource = wrapWholeWord(regexSource);
  }

  const flags = buildFlags(caseSensitive);
  return {
    kind: 'regex',
    regex: new RegExp(regexSource, flags),
    replacement,
  };
}

/**
 * Convenience: returns the unmodified replacement string in literal
 * mode, or processes `$$`/`$&`/`$N` references in regex mode (this is
 * already what JS `String.prototype.replace` does internally — exposed
 * here only for testing).
 */
export const __testing = {
  buildFlags,
  applyFlexibleWhitespace,
  applyFlexibleWhitespaceLiteral,
  wrapWholeWord,
};
