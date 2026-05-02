# Phase 0 Research: `find_and_replace`

**Branch**: `013-find-and-replace` | **Date**: 2026-05-03 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

This document resolves every NEEDS CLARIFICATION item from the Technical Context section of [plan.md](./plan.md) and records the empirical / library / licensing facts that the implementation depends on. The 18 spec-level Clarifications already pin behavioral semantics; this Phase 0 work is about the *implementation* choices that follow from those semantics.

## R1 — Cyanheads/obsidian-mcp-server license verification (LAYER 1 attribution)

**Decision**: Treat `cyanheads/obsidian-mcp-server` as the LAYER 1 source for the per-note replacement primitive's algorithm only (sequential left-to-right scan over a single note, single-pass global semantics — what JS `String.prototype.replaceAll` and `replace(/.../g, ...)` give you natively). Add an attribution header in `pattern-builder.ts` and `replacer.ts` referencing the project and the `obsidian_replace_in_note` tool by name.

**Rationale**: Per FR-025, attribution is required regardless of license — but if the license is incompatible with this project's license, we'd have to re-implement from scratch and call out that we did. The brief states "likely MIT" and asks us to verify; verification is part of the implementation work. The actual algorithm (single-pass global JS replace) is so canonical that the *attribution* is the load-bearing thing, not the code lift — JS's standard library does the work. We are crediting the *idea* of doing per-note find-and-replace through the REST API at a single tool surface, and crediting the parameter shape (`replacements` array, etc.) to the extent we adopt it.

**Alternatives considered**:
- Reimplement without attribution: spec rules this out (FR-025 mandates attribution).
- Vendor cyanheads's source verbatim: heavy and unnecessary; the algorithm is one line of JS.
- Skip the attribution: would require a different prior-art credit story; the brief explicitly asks for cyanheads to be named.

**Action item for implementation**: Verify the license file in `cyanheads/obsidian-mcp-server` (likely `LICENSE` at the repo root) is permissive (MIT, Apache-2, BSD). If permissive, proceed with attribution. If non-permissive (GPL, AGPL, custom): pivot to "inspired by" language, do not lift any code patterns, and document the decision in this section. **Failing this check blocks the merge per FR-025.**

## R2 — Blacksmithers/vaultforge license verification (LAYER 2 attribution)

**Decision**: Treat `blacksmithers/vaultforge` as the LAYER 2 source for the dry-run preview pattern (per-file diff with abridged before/after) and the vault-walk strategy (enumerate `.md` files, fetch each, apply replacement, write back). Add an attribution header in `region-detector.ts` and `preview-formatter.ts` referencing the project and the `grep-sub` tool.

**Rationale**: FR-026 makes the attribution conditional on direct porting of dry-run logic or vault-walk strategy. Both are direct ports in spirit (the dry-run-vs-commit toggle and the per-file diff preview pattern), so attribution applies. The *exact* preview shape is our own (Q1 / session 4 picked a structured per-match object, FR-015), so we are crediting the *concept* of dry-run-with-preview, not the exact format.

**Alternatives considered**:
- Use only conceptual prior-art credit: same outcome but vaguer; the brief explicitly names vaultforge.
- Add attribution only on `preview-formatter.ts`: the vault-walk strategy ALSO came from there per the brief, so `walker.ts` deserves attribution too — but `walker.ts` is the layer with the most LAYER-3 contribution (multi-vault routing through `getRestService`), so the attribution there is split: "vault-walk strategy borrowed from vaultforge; per-vault dispatch is original."

**Action item for implementation**: Verify `blacksmithers/vaultforge`'s license. If permissive, proceed. If non-permissive: same fallback as R1 — "inspired by" language, no code lifting, documented here. **Same merge gate as R1.**

## R3 — JS replace semantics for single-pass global (FR-006)

**Decision**: Use JavaScript's built-in `String.prototype.replaceAll(searchString, replacement)` for literal mode and `String.prototype.replace(regex, replacement)` (with the regex carrying the `g` flag, per FR-013) for regex mode. Both operate over the searchable spans (skip regions carved out per FR-009a), not the original full content.

**Rationale**: ECMAScript's spec for `replaceAll` and global-`replace` already implements:
- Single-pass global semantics (FR-006): each match in the input string is replaced exactly once; the replacement output is NOT re-scanned. ✓
- Capture-group `$1`/`$&`/`$$` handling for the regex form (FR-013). ✓
- Empty-match auto-advance (FR-013, Q3 / session 3): the engine advances by one code unit per empty match to avoid infinite loops. ✓

We get all three for free from the runtime. There is no need for a custom replacement loop unless we discover a constraint the standard methods can't satisfy — which we have not.

**Alternatives considered**:
- Custom hand-written replace loop: more LOC, more bugs, no functional gain. Rejected.
- Use `String.prototype.split(search).join(replacement)`: only works for literal mode without capture groups; doesn't honor case-insensitive matching; would need a parallel implementation for regex mode. Rejected — split/join is a cute pattern but doesn't match our requirements.

**Implementation note**: For literal mode, `replaceAll` requires a string `searchString` (not a regex). For literal mode WITH `caseSensitive: false` or `flexibleWhitespace: true`, we MUST compile the literal string to a regex (after `escapeRegex` per [src/tools/rename-file/regex-passes.ts](../../src/tools/rename-file/regex-passes.ts)) and call `replace(regex, ...)` instead — `replaceAll(string, ...)` is case-sensitive and has no whitespace-flexibility. This is a clean one-line branch in `pattern-builder.ts`.

## R4 — Region detector implementation: in-tree vs library

**Decision**: Implement both region detectors in-tree as small regex-based scanners. No CommonMark library dependency.

**Rationale**:
- FR-007 (CommonMark line-anchored fences): the rule is `^ {0,3}\`{3,}.*$` for the opener and a matching backtick-count line-anchored closer. This is a single multi-line regex with the `m` flag, plus a small bookkeeping loop to track opener-closer pairs. Estimated 30–50 LOC.
- FR-008 (non-greedy `<!--…-->` spanning newlines): a single regex `/<!--[\s\S]*?-->/g` captures all comments; the unclosed-case handling (FR-008's "runs to end-of-file") needs a small post-pass. Estimated 20–30 LOC.
- A CommonMark library (`remark`, `markdown-it`) would add a runtime dependency for ~50 KB of bundled code that does far more than we need. Constitution: "new runtime dependencies MUST be justified." A 50 LOC regex scanner is justified by the in-house `escapeRegex` precedent already in [src/tools/rename-file/regex-passes.ts](../../src/tools/rename-file/regex-passes.ts).

**Alternatives considered**:
- `remark` + `remark-parse`: full CommonMark AST. Heavy; total dep weight ~200 KB; serializes/deserializes per file. Rejected.
- `markdown-it`: lighter than remark but still ~80 KB and tokenizes the entire document. Rejected.
- Use Obsidian's own renderer (impossible — we don't run inside Obsidian).
- Hand-rolled tokenizer (no regex): more code, no semantic gain over regex. Rejected.

**Implementation note**: The two detectors run independently per FR-009 (independent + union). They each emit `Array<{ start: number, end: number }>` in code-unit coordinates. The replacer takes the union of both arrays and operates on the complement — i.e., the searchable spans are the byte ranges NOT in any skipped region. Critical: `start` / `end` are JS string indices (code units), NOT byte offsets — JS strings are UTF-16, so byte offsets would differ for non-BMP characters. All arithmetic stays in code-unit space.

## R5 — Region union and skip-region carve-out algorithm (FR-009 / FR-009a)

**Decision**: The replacer receives a sorted array of skip-region ranges (after merging the union per FR-009) and processes each searchable span independently. For each searchable span:

1. Apply the compiled regex / literal pattern to the span.
2. For each match, compute the byte position in the *original* file by adding the span's start offset.
3. Substitute the replacement text and append to the output buffer.

Then the output is reassembled by interleaving the rewritten spans with the preserved-byte-for-byte skipped regions, in order.

**Rationale**:
- This guarantees FR-009a's "matches MUST NOT cross skip-region boundaries" — the regex never sees content from two different searchable spans concatenated, so it cannot match across them.
- This guarantees the byte-for-byte preservation of skipped regions per FR-007 / FR-008 — the skipped bytes are NEVER fed into the replacer; they are just appended to the output in their original positions.
- `\b` boundary checks at region edges work correctly because the regex sees the span boundaries as the natural string-end / string-start of its input — `\b` at position 0 matches if the first char is a word char, which is the same outcome as if the regex saw the original-content edge char (typically a non-word char like `<` or `` ` ``). FR-009a's edge-case clarification holds.

**Alternatives considered**:
- Replace inside skipped regions then revert: wastes work, error-prone (have to re-fetch the original bytes from somewhere).
- Replace sentinel codepoints (Option D from session 4 / Q3): introduces a sentinel that could collide with user content. Rejected.
- Apply the regex to the full original content, then post-filter matches that intersect skipped regions: works but loses FR-009a's "matches must not cross boundaries" guarantee — a match that *crosses* a boundary would be silently kept or dropped depending on the post-filter rule, which is the ambiguity Q3 ruled against.

**Implementation note**: The regex is compiled once per call (stateful via `lastIndex` if we use exec-loop, or stateless if we use `replace` which resets internally). `replace` is stateless and simpler — use that.

## R6 — CRLF/LF preservation strategy (FR-016a)

**Decision**: Read file content as a JavaScript string (UTF-16 internally). Pass the raw string to the replacer; pass the raw string to `rest.putContent` for write-back. Do NOT call `replace(/\r\n/g, '\n')` or any normalization. Test on a CRLF-encoded fixture to confirm round-trip preservation.

**Rationale**: `axios` with `responseType: 'text'` already returns the response body as a string with bytes preserved. Node's UTF-8 encoder/decoder does NOT modify line endings; CRLF stays CRLF, LF stays LF. The replacer operates on the string in UTF-16-code-unit space, but `\r` and `\n` are each one code unit, so all replacement math is unaffected by line-ending choice. The PUT request sends the string as the body with `Content-Type: text/markdown`; axios passes the bytes through.

**Risk**: Some HTTP middleware on the Obsidian REST plugin side could in principle normalize line endings, but the plugin's documented behavior is to pass the body through verbatim. The CRLF round-trip test in `handler.test.ts` is the safety net — if the plugin normalizes, we discover it at test time and document the limitation.

**Alternatives considered**:
- Detect dominant line ending and preserve it: violates FR-016a's "byte-for-byte" guarantee on mixed-ending files. Rejected.
- Convert to LF on read, restore on write: adds complexity for no benefit on uniform-ending files; loses byte-for-byte on mixed-ending files. Rejected.

## R7 — Output-size cap detection (FR-024a + FR-013 empty-match handling)

**Decision**: Compute the post-replacement file's byte length AFTER the replacer runs but BEFORE issuing `rest.putContent`. If `Buffer.byteLength(output, 'utf8') > 5 * 1024 * 1024`, emit a `skipped` entry with `reason: "output_size_exceeded"` and skip the PUT. The 5 MB threshold is the same as the input cap.

**Rationale**: FR-024a was extended in round 3 to cover both input AND output. The natural place to enforce the output cap is right before the PUT — the work to compute the output is sunk cost at that point, and gating the PUT prevents the destructive part of the operation. Using `Buffer.byteLength(s, 'utf8')` gives the actual UTF-8 byte length, which is what the REST API will store; using `s.length` would give code-unit count and would mis-count for non-BMP characters.

**Alternatives considered**:
- Estimate output size from `input.length + replacements.length * (replacement.length - search.length)`: only works for fixed-length-difference cases; breaks for regex with capture groups, empty matches, etc. Rejected.
- Cap matches before computing output: imposes a hard match-count limit instead of a size limit; less natural and harder to predict for users. Rejected.
- Stream-process and abort partway: doesn't compose with `rest.putContent`'s all-or-nothing PUT semantics. Rejected.

## R8 — Multi-vault dispatch surface for `rest.findAndReplace` (LAYER 3 contract)

**Decision**: Add `findAndReplace` as a public method on `ObsidianRestService`. It takes a single options object: `{ search, replacement, regex?, caseSensitive?, wholeWord?, flexibleWhitespace?, skipCodeBlocks?, skipHtmlComments?, dryRun?, pathPrefix?, verbose? }` (note: NO `vaultId` — the per-vault routing happens *outside* this method, by virtue of which `ObsidianRestService` instance the caller invokes it on). The method returns `Promise<FindAndReplaceResult>` — the same response shape the public tool returns (modulo MCP `CallToolResult` wrapping).

**Rationale**:
- FR-017 / FR-018 / FR-019 say multi-vault routing happens via `getRestService(vaultId)` plumbing. The public tool's `handleFindAndReplace` reads `args.vaultId`, calls `getRestService(vaultId)` to resolve the per-vault service, then calls `rest.findAndReplace(...)` — the method itself is vault-agnostic at its own boundary because it operates on whichever REST service it lives on. This matches the existing pattern: every other method on `ObsidianRestService` (`listFilesInVault`, `getFileContents`, `putContent`, etc.) is vault-agnostic at its boundary; multi-vault routing is the dispatcher's job in [src/index.ts](../../src/index.ts).
- 012's [`rename-file/handler.ts`](../../src/tools/rename-file/) (when it ships per [012 plan §Implementation order constraint](../012-safe-rename/plan.md#summary)) needs to call `rest.findAndReplace(...)` four times (Passes A–D) on a per-vault-resolved REST service. By making the method vault-agnostic at its boundary, 012 calls it on whatever `rest` instance the dispatcher already resolved for the rename — no new plumbing needed in 012.

**Alternatives considered**:
- Make `findAndReplace` take a `vaultId` parameter: forces every caller (012's handler, the public tool) to pass through the vault resolution, duplicating the dispatcher's job. Rejected — breaks the existing service-layer convention.
- Make `findAndReplace` a free function that takes a `rest` parameter: same outcome as a method, but inconsistent with the rest of `ObsidianRestService`'s API shape. Rejected.

**Implementation note**: The internal `findAndReplace` method is what does the LAYER 1 + LAYER 2 work (region detection, replacement, dry-run vs commit, response assembly). The public tool's handler ONLY does (a) zod validation, (b) vault resolution to get the right `rest` instance, (c) calls `rest.findAndReplace(...)`, (d) wraps the result in a `CallToolResult`. This keeps the LAYER 3 wrapper thin and matches the existing [`patch-content` handler](../../src/tools/patch-content/handler.ts) shape.

## R9 — Preview context truncation by Unicode code points (FR-015)

**Decision**: For each match's `before` and `after` context, slice up to 40 Unicode code points (NOT 40 UTF-16 code units, NOT 40 bytes). Use `Array.from(str)` to enumerate code points safely; truncation by `str.slice(0, 40)` is wrong for non-BMP characters (a single emoji surrogate-pair would be split mid-character, producing invalid UTF-16).

**Rationale**: FR-015 says "Truncation is by Unicode code points, not bytes." Emoji and certain CJK characters are non-BMP (surrogate pairs in UTF-16) — slicing by code units would produce a lone-surrogate string that JSON-serializes to mojibake. `Array.from(str).slice(0, 40).join('')` walks code points correctly. Performance impact: O(string-length) per slice, but the slice runs at most twice per match preview (left + right context), and we cap at 1–3 matches per file in `previews`, so the total cost is bounded.

**Alternatives considered**:
- `str.slice(0, 40)`: incorrect on non-BMP. Rejected.
- `str.substring(0, 40)`: same issue. Rejected.
- `Intl.Segmenter` for grapheme-cluster boundary truncation: more correct (would not split a flag emoji's two-codepoint composition), but requires Node 16+ ICU and adds complexity for marginal benefit. Out of scope for round-1; capture as a future polish.

## R10 — Vault enumeration depth and recursion strategy (FR-004 + FR-024b)

**Decision**: Use `rest.listFilesInVault()` for the root, then recurse through subdirectories with `rest.listFilesInDir(dirpath)`. Filter at each level: skip any directory whose name starts with `.` (FR-024b — applies recursively); only descend into non-dot directories. For files, accept any whose name ends in `.md` / `.MD` / `.Md` / `.mD` (FR-024 case-insensitive). Apply `pathPrefix` filter once per file (after the full vault-relative path is assembled), using the directory-segment match rule from FR-004.

**Rationale**: The Obsidian Local REST API plugin's `/vault/` endpoint returns the immediate root entries (files and directory names ending in `/`); the `/vault/{path}/` endpoint returns the immediate entries of that directory. There is NO recursive-listing endpoint, so the wrapper has to recurse itself. This matches how [`tests/inherited/`](../../tests/inherited/) and other existing tools enumerate.

**Alternatives considered**:
- Use the Obsidian REST plugin's search endpoint to find all `.md` files: doesn't give us the directory structure for `pathPrefix` filtering; doesn't return paths in a deterministic order. Rejected.
- Build a global file index up-front: nice for big vaults but adds memory cost; the recursive walk is fast enough for SC-001's 1,000-note target (each list call is ~10–50 ms; a 1,000-file vault with 50 directories takes ~1–2 s of enumeration). Acceptable.
- Parallel recursion (Promise.all over subdirectories): would speed up enumeration for deep vaults, but adds complexity and is gated by REST API rate limiting (no documented cap, but deferring parallelism keeps us conservative). Rejected for round 1.

**Implementation note**: The enumeration produces `Array<string>` of vault-relative file paths. Sorting (FR-020c — lexicographic UTF-8 ascending) happens at response-assembly time, not enumeration time, so the walker can return paths in whatever order the recursive calls produce — the response builder normalizes.

## R11 — Vault-relative path normalization

**Decision**: All vault-relative paths in the response (in `perFile[i].filename`, `failures[j].filename`, `skipped[k].filename`) MUST use forward slashes (`/`) regardless of host platform, and MUST NOT have a leading `/`. Example: `Projects/AcmeWidget/notes.md`.

**Rationale**: The Obsidian REST API uses forward slashes in its URLs and treats vault-relative paths as forward-slash-separated everywhere. Cross-platform tests and assertions on `filename` strings need a single canonical form — backslashes on Windows would break test reproducibility (compounding with FR-020c's lexicographic sort, which produces different orderings for `/` vs `\`).

**Alternatives considered**:
- Use `path.sep` (platform-dependent): breaks cross-platform test reproducibility. Rejected.
- Use whatever the REST API returns: fine in practice (it's already forward-slash) but the contract should pin it explicitly so tests can rely on it. Done.

## R12 — Compatibility with 012's `rename_file` regex passes

**Decision**: 012's [`regex-passes.ts`](../../src/tools/rename-file/regex-passes.ts) builds patterns assuming `flags: 'g'` and the standard `skipCodeBlocks: true`, `skipHtmlComments: true` semantics. The patterns use `(?<!!)\\[\\[...\\]\\]` (negative lookbehind for `!`) and `[^\\]|]*` (negated character class). The regex flag set we ship (`g` always, `i` if `caseSensitive: false`, `m` always-on, `u` always-on, `s` OFF — per FR-013) MUST be compatible with these patterns.

**Verification**:
- Lookbehind `(?<!!)`: requires regex `u` flag for `\u` Unicode-class behavior; works with `m` flag (anchors per-line) without conflict; works with `g` flag. ✓
- Negated character class `[^\\]|]*`: standard regex syntax; works with `u` flag (no surrogate-pair problems for ASCII contents); works with all flags. ✓
- Multi-line patterns are NOT used by 012's passes — Pass A/B/C/D each match a single wikilink which is on one line. The `m` flag's effect on `^`/`$` does not impact 012's patterns (no anchors used). ✓
- 012's passes do NOT rely on `s` (dotall): `\[\[` … `\]\]` patterns don't use `.` to span newlines. ✓

**Conclusion**: 012's regex passes work as-is with our flag set. No changes to 012 are required by this feature. The contract is documented in [contracts/find_and_replace.md](./contracts/find_and_replace.md).

## R13 — Tool description content (FR-003)

**Decision**: The tool description string MUST contain three substrings, pinned by `registration.test.ts`:

1. `"clean git working tree"` (or equivalent canonical phrase) — the precondition per FR-003(a).
2. `"dry-run is the safety net"` (or canonical equivalent) — the documented safety net per FR-003(b).
3. `"last-write-wins"` (or canonical equivalent) — the concurrency posture per FR-003(c) and Q4 / session 1 of Clarifications.

**Rationale**: This mirrors the [012 rename_file pattern](../../src/tools/rename-file/tool.ts) where four description substrings are pinned. The tests act as a brake on accidental edits that lose load-bearing user-facing warnings.

**Implementation note**: The exact wording should also mention `pathPrefix` is case-sensitive (per FR-004), since this is a Windows-user footgun that the description should warn about explicitly. This is a fourth pinned substring: `"case-sensitive"` (in the `pathPrefix` discussion).

## R14 — Attribution README addition (FR-028)

**Decision**: Add a new section to [`README.md`](../../README.md) titled **"Attributions"** (or extend the existing prior-art / acknowledgments section if one exists). The section MUST name three contributors with the lifted-vs-original split made explicit:

```markdown
### Attributions for `find_and_replace`

`find_and_replace` is composed of three layers, two of which carry attribution
to upstream Obsidian-MCP projects:

- **LAYER 1 — Per-note replacement primitive**: algorithm credited to
  [cyanheads/obsidian-mcp-server](https://github.com/cyanheads/obsidian-mcp-server)'s
  `obsidian_replace_in_note` tool (license: [verified at implementation time]).
  Source-header attribution lives in `src/tools/find-and-replace/pattern-builder.ts`
  and `src/tools/find-and-replace/replacer.ts`.

- **LAYER 2 — Vault-wide composition + dry-run**: pattern credited to
  [blacksmithers/vaultforge](https://github.com/blacksmithers/vaultforge)'s
  `grep-sub` tool (license: [verified at implementation time]). Dry-run preview
  format and vault-walk strategy borrowed. Source-header attribution lives in
  `src/tools/find-and-replace/region-detector.ts` and
  `src/tools/find-and-replace/preview-formatter.ts`.

- **LAYER 3 — Multi-vault dispatch wrapper**: original contribution of this
  project. Wraps LAYER 1 + LAYER 2 with the existing `getRestService(vaultId)`
  plumbing (inherited from Connor Britain's upstream and hardened across 7
  configured vaults) so the entire find-and-replace surface routes per-vault
  by default. None of cyanheads, vaultforge, or MCPVault provides this. Source
  in `src/tools/find-and-replace/walker.ts` (vault-walk uses LAYER-3 multi-vault
  routing) and `src/tools/find-and-replace/response-builder.ts`.
```

**Rationale**: FR-028 names these three contributors plus the project itself and requires the lifted-vs-original split to be explicit. The section sits in `README.md` because it's the canonical place users look for licensing / attribution context. The exact wording can be adjusted in implementation but the four attribution targets (cyanheads, vaultforge, project's LAYER 3, plus per-source-file headers) are non-negotiable.

## R15 — `failures[].error` shape (deferred from clarifications)

**Decision** (deferred to spec is silent; planning-level call): `failures[i].error` is a string — the human-readable message from the upstream `ObsidianApiError` / `ObsidianTimeoutError` / `ObsidianNotFoundError`'s `.message` field, formatted as the existing `safeCall` already produces (`"Obsidian API Error 503: Service Unavailable"`). NOT a structured `{ code, message }` object in this round.

**Rationale**: A structured error object is more useful for clients but is YAGNI for round 1 — the human-readable string already preserves the upstream status code (e.g., `"Obsidian API Error 503: ..."` or `"Obsidian API Error 404: File not found"`), matching Principle IV's requirement to preserve the chain of custody. Upgrading to a structured `{ code, message, cause }` object is a future polish that doesn't break existing clients.

**Alternatives considered**:
- Structured `{ code, message }` from day one: more typing work, no current consumer, can be added later without breaking string consumers if we add it as `error_detail` alongside the existing `error` string.

## R16 — Total response size cap (deferred from clarifications)

**Decision** (planning-level, NOT in spec): Cap the response body at 1 MB. If `verbose: true` produces a `perFile` array large enough that the total response exceeds 1 MB after JSON serialization, the response body MUST be truncated and a `responseTruncated: true` flag MUST be added. Implementation detail: build the response object, JSON-serialize it, check size; if over cap, drop entries from `perFile` (least-impactful first — fewest replacements) until under cap.

**Rationale**: SC-006 already bounds the no-match case at 500 bytes; this 1 MB cap bounds the verbose-many-matches case. The cap protects the MCP transport from oversized messages and matches the spirit of FR-024a's per-file size cap.

**Alternatives considered**:
- No cap: a 50,000-note vault with `verbose: true` could produce a multi-megabyte response that some MCP clients refuse. Rejected.
- Stream the response: not supported by the MCP `CallToolResult` shape. Rejected.
- Hard error if response would exceed cap: surprising and unhelpful — better to truncate with a flag the client can detect.

## R17 — Test runner availability

**Decision**: Use `vitest` (already configured per [vitest.config.ts](../../vitest.config.ts)). No new test dependency.

**Rationale**: Constitution version 1.0.0's Sync Impact Report flagged that "Test runner is not yet configured in package.json. Principle II creates an implicit dependency: a test runner (e.g., vitest) MUST be added before the next public tool is shipped or amended." Since 012's plan also assumes vitest, and `vitest.config.ts` already exists in the repo, this dependency is already met. Verify by running `npm test` in the implementation phase.

## Summary of unresolved items

**None.** Every implementation choice has a documented decision and rationale. The two license-verification items (R1 cyanheads, R2 vaultforge) are runtime checks that block the merge, not unresolved design decisions — they are gated tasks for the implementation phase, not Phase 0 ambiguities.

The plan and downstream Phase 1 artifacts (data-model.md, contracts/, quickstart.md) can proceed.
