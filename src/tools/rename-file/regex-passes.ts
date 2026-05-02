/**
 * rename_file tool: wikilink-rewrite regex builders + escapeRegex utility.
 *
 * Spike-independent module that ships with the Option-B documentation
 * pivot. The handler (T005, deferred until Tier 2 backlog item 25's
 * `find_and_replace` lands) imports these builders to construct the
 * four regex passes documented in
 * `specs/012-safe-rename/contracts/rename_file.md` §"Composition algorithm"
 * step 6.
 *
 * Each builder returns `{ pattern, replacement }` strings that the
 * handler passes opaquely to `rest.findAndReplace` along with
 * `flags: 'g'`, `skipCodeBlocks: true`, `skipHtmlComments: true`. The
 * wrapper does not interpret what the regex matches — that's
 * `find_and_replace`'s job (SC-005).
 *
 * Tested in `tests/tools/rename-file/regex-passes.test.ts` against
 * synthetic inputs covering each shape from FR-014 plus negative cases
 * (different-basename non-matches, regex-metacharacter escaping, etc.).
 */

/**
 * Escape regex metacharacters in a literal string so it can be safely
 * substituted into a regex template. Required for FR-014 correctness
 * with filenames containing `(`, `)`, `.`, `+`, `*`, `?`, `^`, `$`,
 * `{`, `}`, `|`, `[`, `]`, or `\` — e.g. `Obsidian MCP Server (Multi-Vault Edition)`.
 *
 * Canonical 1-line implementation borrowed from common JS practice
 * (research §R10). No external dependency added.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Inputs for Pass A / B / C builders (no folder context needed).
 */
export interface PassInputBasenames {
  oldBasename: string;
  newBasename: string;
}

/**
 * Inputs for Pass D builder (cross-folder rename — needs both folders).
 */
export interface PassDInput extends PassInputBasenames {
  oldFolder: string;
  newFolder: string;
}

/**
 * Pass A — bare and aliased wikilinks.
 *
 * Targets: `[[basename]]`, `[[basename|alias]]`.
 * Does NOT match heading-suffixed forms (those are Pass B's territory)
 * or embed-prefixed forms (Pass C's territory — the leading `!` is
 * excluded via a negative lookbehind so `![[basename]]` doesn't match
 * here).
 *
 * Capture group $2 captures the optional `|alias` segment (with the pipe).
 */
export function buildPassA(input: PassInputBasenames): { pattern: string; replacement: string } {
  const old = escapeRegex(input.oldBasename);
  return {
    pattern: `(?<!!)\\[\\[(${old})(\\|[^\\]]*)?\\]\\]`,
    replacement: `[[${input.newBasename}$2]]`,
  };
}

/**
 * Pass B — heading-targeted wikilinks (with optional alias).
 *
 * Targets:
 *   `[[basename#heading]]`
 *   `[[basename#heading|alias]]`
 *   `[[basename#^block-id]]`  (block references — `#^block-id` is a valid `#…` segment)
 *
 * Capture group $2 captures the `#heading` (or `#^block-id`) segment.
 * Capture group $3 captures the optional `|alias` segment (with the pipe).
 *
 * The heading segment match `[^\]|]*` excludes `]` and `|` so the regex
 * doesn't run past the bracket close or into the alias.
 */
export function buildPassB(input: PassInputBasenames): { pattern: string; replacement: string } {
  const old = escapeRegex(input.oldBasename);
  return {
    pattern: `(?<!!)\\[\\[(${old})(#[^\\]|]*)(\\|[^\\]]*)?\\]\\]`,
    replacement: `[[${input.newBasename}$2$3]]`,
  };
}

/**
 * Pass C — embed wikilinks (with optional alias).
 *
 * Targets: `![[basename]]`, `![[basename|alias]]`.
 * Critical for attachment renames (image/PDF/audio embeds).
 *
 * Capture group $2 captures the optional `|alias` segment (with the pipe).
 */
export function buildPassC(input: PassInputBasenames): { pattern: string; replacement: string } {
  const old = escapeRegex(input.oldBasename);
  return {
    pattern: `!\\[\\[(${old})(\\|[^\\]]*)?\\]\\]`,
    replacement: `![[${input.newBasename}$2]]`,
  };
}

/**
 * Pass D — full-path wikilinks (cross-folder rename only).
 *
 * Targets:
 *   `[[old-folder/basename]]`
 *   `[[old-folder/basename#heading]]`
 *   `[[old-folder/basename|alias]]`
 *   `[[old-folder/basename#heading|alias]]`
 *
 * Capture group $2 captures the optional `#heading` (or `#^block-id`) segment.
 * Capture group $3 captures the optional `|alias` segment.
 *
 * Skipped on same-folder renames (`oldFolder === newFolder`) — no full-path
 * references could have changed in that case.
 */
export function buildPassD(input: PassDInput): { pattern: string; replacement: string } {
  const oldBase = escapeRegex(input.oldBasename);
  const oldFolder = escapeRegex(input.oldFolder);
  return {
    pattern: `(?<!!)\\[\\[${oldFolder}\\/(${oldBase})(#[^\\]|]*)?(\\|[^\\]]*)?\\]\\]`,
    replacement: `[[${input.newFolder}/${input.newBasename}$2$3]]`,
  };
}
