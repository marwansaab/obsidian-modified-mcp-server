---

description: "Task list for the find_and_replace feature"
---

# Tasks: Vault-Wide Find and Replace (`find_and_replace`)

**Input**: Design documents from `/specs/013-find-and-replace/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/find_and_replace.md](./contracts/find_and_replace.md), [quickstart.md](./quickstart.md)

**Tests**: This project's [Constitution Principle II (NON-NEGOTIABLE)](../../.specify/memory/constitution.md) requires every public MCP tool to ship with at least one happy-path and one failure-path test. Tests are therefore included as load-bearing tasks for each user story, not as optional add-ons.

**Organization**: Tasks are grouped by the four user stories from [spec.md](./spec.md#user-scenarios--testing-mandatory). US1 is the MVP (literal sweep + dry-run safety net); US2/US3/US4 are additive enhancements that build on US1's pipeline rather than standing fully alone — the `Dependencies` section documents this honestly.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks).
- **[Story]**: Which user story this task belongs to (US1 / US2 / US3 / US4).
- File paths are absolute or repo-relative as the work demands.

## Path Conventions

Single-project TypeScript layout per [plan.md §Project Structure](./plan.md#project-structure):

- Source: [src/tools/find-and-replace/](../../src/tools/find-and-replace/), [src/services/](../../src/services/), [src/index.ts](../../src/index.ts), [src/tools/index.ts](../../src/tools/index.ts).
- Tests: [tests/tools/find-and-replace/](../../tests/tools/find-and-replace/), [tests/services/find-and-replace/](../../tests/services/find-and-replace/).
- Documentation: [README.md](../../README.md) attributions section per [research.md §R14](./research.md#r14--attribution-readme-addition-fr-028).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Verify project prerequisites and create the new directories. License-verification gates here are MERGE-BLOCKING per [research.md §R1](./research.md#r1--cyanheadsobsidian-mcp-server-license-verification-layer-1-attribution) and [§R2](./research.md#r2--blacksmithersvaultforge-license-verification-layer-2-attribution).

- [x] T001 [P] License verification — confirm `cyanheads/obsidian-mcp-server` carries a permissive license (MIT / Apache-2.0 / BSD / ISC) per [research.md §R1](./research.md#r1--cyanheadsobsidian-mcp-server-license-verification-layer-1-attribution); record the verified SPDX ID in `research.md §R1` replacing the `[verified at implementation time]` placeholder; if non-permissive, follow the documented fallback (rewrite headers as "inspired by" and lift no code patterns)
- [x] T002 [P] License verification — confirm `blacksmithers/vaultforge` carries a permissive license per [research.md §R2](./research.md#r2--blacksmithersvaultforge-license-verification-layer-2-attribution); record the verified SPDX ID in `research.md §R2`; same fallback if non-permissive
- [x] T003 Run `npm test` baseline against `main` to confirm vitest is configured and the existing test suite is green before any new code lands
- [x] T004 Create directory scaffolding: `mkdir -p src/tools/find-and-replace tests/tools/find-and-replace tests/services/find-and-replace`

**Checkpoint**: Both licenses verified, scratch dirs ready, vitest baseline green.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Build the modules that EVERY user story depends on — the boundary schema, the vault walker, and the response builder. No user story work can begin until this phase is complete.

**⚠️ CRITICAL**: User stories MUST NOT begin until Phase 2 is complete.

- [x] T005 Define the zod boundary schema in [src/tools/find-and-replace/schema.ts](../../src/tools/find-and-replace/schema.ts): `FindAndReplaceRequestSchema` covering all 12 input fields per [data-model.md §1](./data-model.md#1-findandreplacerequest-boundary-input); enforce `search.min(1)` (FR-022); add `.superRefine` that pre-compiles the regex when `regex: true` using the FR-013 always-on flag set (`gimu`) and surfaces compile errors via `ctx.addIssue` so the boundary reports FR-023 with a precise field path; export `assertValidFindAndReplaceRequest(args: unknown): FindAndReplaceRequest` helper that throws on violation; LAYER 3 attribution header (project original). **Note**: this task subsumes regex compile validation entirely — there is no follow-up schema task in US2 for it.
- [x] T006 [P] Schema tests in [tests/tools/find-and-replace/schema.test.ts](../../tests/tools/find-and-replace/schema.test.ts): empty `search` rejected (FR-022); regex compile error rejected with field path (FR-023); all defaults applied; `pathPrefix` accepts strings; `vaultId` accepts strings; `verbose` defaults to `false`
- [x] T007 Implement the vault walker in [src/tools/find-and-replace/walker.ts](../../src/tools/find-and-replace/walker.ts): export `walkVault(rest: ObsidianRestService, pathPrefix?: string): Promise<string[]>`; recursively enumerate via `rest.listFilesInVault()` then `rest.listFilesInDir(dir)`; filter out any path segment beginning with `.` (FR-024b dot-prefix exclusion); accept `.md`, `.MD`, `.Md`, `.mD` extensions case-insensitively (FR-024); apply `pathPrefix` directory-segment match (FR-004) — exact equality OR prefix-followed-by-`/`, trailing slash normalized away, case-sensitive on all platforms; return forward-slash vault-relative paths with no leading slash (R11); LAYER 3 attribution header with vault-walk-strategy credit to vaultforge per R2
- [x] T008 [P] Walker tests in [tests/tools/find-and-replace/walker.test.ts](../../tests/tools/find-and-replace/walker.test.ts) against a mocked `ObsidianRestService`: dot-prefix exclusion (`.obsidian/foo.md`, `subdir/.hidden/bar.md`); `.md` case-insensitive (`Foo.MD`, `Foo.Md` accepted); non-`.md` files excluded; `pathPrefix` segment match (`"Projects"` matches `Projects/foo.md` but NOT `Projects.md`); trailing-slash normalization; case-sensitivity on Windows-typical paths
- [x] T009 Implement the response builder in [src/tools/find-and-replace/response-builder.ts](../../src/tools/find-and-replace/response-builder.ts): export `assembleResult(input: { perFileResults, request, resolvedVaultId, dryRun }): FindAndReplaceResult` per [data-model.md §5](./data-model.md#5-findandreplaceresult-response-shape); compute aggregate counters (`filesScanned`, `filesModified`, `filesSkipped`, `totalReplacements`, `totalMatchesInSkippedRegions`); sort `perFile` / `failures` / `skipped` arrays by `filename` ascending lexicographic UTF-8 (FR-020c); omit empty arrays; apply [research.md §R16](./research.md#r16--total-response-size-cap-deferred-from-clarifications) 1 MB response cap with `responseTruncated: true` flag; LAYER 3 attribution header (project original)
- [x] T009a [P] Response-builder tests in [tests/tools/find-and-replace/response-builder.test.ts](../../tests/tools/find-and-replace/response-builder.test.ts) covering the foundational behavior: aggregate counter math; FR-020c sort order across `perFile`, `failures`, `skipped` arrays; empty-array omission (`failures: []` → omitted); R16 1 MB response cap with `responseTruncated: true` flag triggered when synthetic input is large enough; **SC-006 — empty-result response for a 5,000-file synthetic enumeration with zero matches JSON-stringifies to under 500 bytes when `verbose: false`**. Depends on T009.

**Checkpoint**: Foundation ready — schema validates inputs, walker enumerates `.md` files, response builder assembles aggregates. User story work can begin.

---

## Phase 3: User Story 1 - Literal Sweep with Dry-Run Safety Net (Priority: P1) 🎯 MVP

**Goal**: Deliver the core productivity win — a single MCP tool call replaces a literal string vault-wide, with `dryRun: true` as the documented safety net. Covers User Story 1 from [spec.md](./spec.md#user-story-1---sweep-a-literal-string-across-the-vault-with-dry-run-safety-net-priority-p1).

**Independent Test**: Per [quickstart.md Part 2](./quickstart.md#part-2--happy-path-literal-sweep-with-dry-run) — call `find_and_replace` with `search: "AcmeWidget"`, `replacement: "Globex"`, `dryRun: true` against a vault containing the literal in 7 notes; verify `filesModified === 7`, `totalReplacements >= 7`, and `git status` shows no changes. Re-call with `dryRun: false`; verify the 7 notes are now modified and the response counts match. SC-002 / SC-005 verified by this test.

### Tests for User Story 1 (Constitution Principle II — NON-NEGOTIABLE)

> Per Principle II, the public tool MUST ship with at least one happy-path and one failure-path test. The handler test (T015) is the constitutional minimum; the others are structural correctness gates that catch regressions cheaply.

- [x] T010 [P] [US1] Pattern-building tests (literal mode only) in [tests/tools/find-and-replace/pattern-building.test.ts](../../tests/tools/find-and-replace/pattern-building.test.ts): literal escape of regex metacharacters; `wholeWord: true` wraps the escaped pattern in `\b…\b` (FR-010); `flexibleWhitespace: true` substitutes `\s+` for whitespace runs after escaping the rest (FR-011); `caseSensitive: false` produces a case-insensitive regex with the `iu` flags (FR-012)
- [x] T011 [P] [US1] Replacer tests (literal core, no skip regions) in [tests/tools/find-and-replace/replacer.test.ts](../../tests/tools/find-and-replace/replacer.test.ts): single-pass global semantics — `search: "old"`, `replacement: "old-new"` does NOT loop (FR-006, Q1); byte-identical no-op when search is absent (FR-014); CRLF/LF preservation byte-for-byte on a CRLF fixture (FR-016a); trailing-newline state preserved (Edge Case + SC-007); empty result on empty input
- [x] T012 [P] [US1] Preview-formatter tests in [tests/tools/find-and-replace/preview-formatter.test.ts](../../tests/tools/find-and-replace/preview-formatter.test.ts): `MatchPreview` shape per FR-015 (`matchIndex`, `lineNumber`, `columnStart`, `before`, `match`, `replacement`, `after`); ≤40 code-point context truncation by Unicode code points (R9 — verify a non-BMP fixture like `🎉` doesn't get split mid-surrogate-pair); newlines preserved literally inside context; multi-byte CJK fixture works
- [x] T013 [P] [US1] `rest.findAndReplace` helper tests in [tests/services/find-and-replace/rest-find-and-replace.test.ts](../../tests/services/find-and-replace/rest-find-and-replace.test.ts): the `RestFindAndReplaceOptions` shape per [contracts/find_and_replace.md §Surface 2](./contracts/find_and_replace.md#surface-2--internal-helper-obsidianrestservicefindandreplaceopts); helper is vault-agnostic at its boundary (NO `vaultId` field on options); helper rejects empty `search` and uncompilable regex; result shape matches `FindAndReplaceResult`; per-file size cap honored on input AND output (FR-024a); confirms 012's call pattern (regex string + `regex: true`, `skipCodeBlocks: true`, `skipHtmlComments: true`) returns the expected shape per [research.md §R12](./research.md#r12--compatibility-with-012s-rename_file-regex-passes)
- [x] T014 [P] [US1] Registration tests in [tests/tools/find-and-replace/registration.test.ts](../../tests/tools/find-and-replace/registration.test.ts): tool name is `find_and_replace`; description contains the four pinned substrings per R13 (`"clean git working tree"`, `"dry-run is the safety net"`, `"last-write-wins"`, `"case-sensitive"`); `inputSchema` derives from `FindAndReplaceRequestSchema` via `zod-to-json-schema` and is JSON-serializable
- [x] T015 [US1] Handler tests in [tests/tools/find-and-replace/handler.test.ts](../../tests/tools/find-and-replace/handler.test.ts) — **THE Principle II minimum**: (a) happy path — vault with N matches in N files returns `{ ok: true, filesScanned, filesModified: N, totalReplacements >= N, totalMatchesInSkippedRegions: 0, filesSkipped: 0 }`; (b) **mid-sweep failure (FR-021a)** — mocked `rest.putContent` rejects on the second file, sweep continues, response is `{ ok: false, ..., failures: [{ filename, error }] }` and `filesModified` reflects only the successfully written files; (c) dry-run zero-write — assert zero `putContent` calls when `dryRun: true`; (d) per-file size cap — file > 5 MB lands in `skipped` with reason `size_exceeded`; (e) CRLF preservation E2E — feed a CRLF-encoded fixture through the full handler and assert byte-for-byte preservation

### Implementation for User Story 1

- [x] T016 [P] [US1] Implement the pattern builder (literal mode) in [src/tools/find-and-replace/pattern-builder.ts](../../src/tools/find-and-replace/pattern-builder.ts): export `buildPattern(req: { search, regex, caseSensitive, wholeWord, flexibleWhitespace }): { regex: RegExp, isLiteralCompiled: boolean }`; for literal mode without `caseSensitive: false` / `wholeWord: true` / `flexibleWhitespace: true`, signal that callers can use `String.prototype.replaceAll` directly (set `isLiteralCompiled: false`, `regex: null`); for any other case, escape the literal first then compile to a `RegExp` with the FR-013 flag set minus the regex-mode-only behaviors; LAYER 1 attribution header (cyanheads)
- [x] T017 [P] [US1] Implement the single-pass replacer in [src/tools/find-and-replace/replacer.ts](../../src/tools/find-and-replace/replacer.ts): export `applyReplacement(content: string, pattern: ReturnType<typeof buildPattern>, replacement: string, _skipRegions?: SkipRegion[]): { output: string, replacementCount: number, matchesInSkippedRegions: number, matches: Array<{ index, lineNumber, columnStart, match, replacement }> }`; for US1 ignore the `skipRegions` parameter — pass `[]` and operate on full content; use `String.prototype.replaceAll` for `isLiteralCompiled: false` (FR-006), and `String.prototype.replace(/.../g, ...)` for compiled regex; preserve trailing-newline state and internal CRLF/LF byte-for-byte (FR-016a); return `output === content` when no match was applied (FR-014 byte-identical no-op); LAYER 1 attribution header (cyanheads)
- [x] T018 [P] [US1] Implement the preview formatter in [src/tools/find-and-replace/preview-formatter.ts](../../src/tools/find-and-replace/preview-formatter.ts): export `buildPreviews(matches: ..., content: string, replacement: string, opts?: { maxPreviews?: number, maxContextCodePoints?: number }): MatchPreview[]`; default `maxPreviews: 3` (FR-015), `maxContextCodePoints: 40` (R9); use `Array.from(str)` to slice context by code points (NOT code units); compute `lineNumber` and `columnStart` from match index; preserve newlines in context; LAYER 2 attribution header (vaultforge)
- [x] T019 [US1] Add the `findAndReplace(opts: RestFindAndReplaceOptions): Promise<FindAndReplaceResult>` method to [src/services/obsidian-rest.ts](../../src/services/obsidian-rest.ts) (the LAYER 3 helper that 012's `rename_file` consumes per [contracts/find_and_replace.md §Surface 2](./contracts/find_and_replace.md#surface-2--internal-helper-obsidianrestservicefindandreplaceopts)) — composes T007 (walker) + T016 (pattern-builder) + T017 (replacer) + T018 (preview-formatter) + T009 (response-builder); per-file: fetch via `getFileContents`; check `Buffer.byteLength(content, 'utf8') > 5*1024*1024` and skip with `size_exceeded` if exceeded; apply replacement; check output size and skip with `output_size_exceeded` if exceeded; if not byte-identical AND not dry-run, call `putContent`; catch per-file errors and record into `failures` (FR-021a best-effort-continue); accumulate `PerFileResult[]`; call `assembleResult` for the final response; LAYER 3 attribution header (project original — distinguishes this fork's find-and-replace from upstream sources). Depends on T005, T007, T009, T016, T017, T018.
- [x] T020 [US1] Implement the public tool handler in [src/tools/find-and-replace/handler.ts](../../src/tools/find-and-replace/handler.ts): export `handleFindAndReplace(args: Record<string, unknown>, rest: ObsidianRestService, resolvedVaultId: string): Promise<CallToolResult>` per [contracts/find_and_replace.md §"Routing (FR-017 / FR-018 / FR-019)"](./contracts/find_and_replace.md#routing-fr-017--fr-018--fr-019); call `assertValidFindAndReplaceRequest(args)` (T005); call `rest.findAndReplace({...req omit vaultId})` (T019); inject `resolvedVaultId` into the result so the response echoes it (FR-018, [data-model.md §5](./data-model.md#5-findandreplaceresult-response-shape)); JSON-stringify the result and wrap in `{ content: [{ type: 'text', text }] }`; depends on T005, T019
- [x] T021 [P] [US1] Implement tool registration in [src/tools/find-and-replace/tool.ts](../../src/tools/find-and-replace/tool.ts): export `FIND_AND_REPLACE_TOOLS: Tool[]` with `name: 'find_and_replace'`; description contains all four R13 substrings (`"clean git working tree"`, `"dry-run is the safety net"`, `"last-write-wins"`, `"case-sensitive"`); `inputSchema = zodToJsonSchema(FindAndReplaceRequestSchema, { $refStrategy: 'none' }) as Tool['inputSchema']`; depends on T005
- [x] T022 [US1] Wire the dispatcher hook in [src/index.ts](../../src/index.ts) per [contracts/find_and_replace.md §"Routing"](./contracts/find_and_replace.md#routing-fr-017--fr-018--fr-019): add a `case 'find_and_replace':` block that resolves the vault id once via `const resolvedVaultId = this.resolveVaultId(args);` then calls `return handleFindAndReplace(args, this.getRestService(resolvedVaultId), resolvedVaultId);` — three args, with `resolvedVaultId` shared between `getRestService` and the handler so the response can echo the resolved id. Depends on T020.
- [x] T023 [US1] Aggregate the new tool into [src/tools/index.ts](../../src/tools/index.ts): import `FIND_AND_REPLACE_TOOLS` from `./find-and-replace/tool.js`; add `...FIND_AND_REPLACE_TOOLS` to the `ALL_TOOLS` array; add to the named-export list; depends on T021
- [ ] T024 [US1] Manual verification per [quickstart.md Part 2](./quickstart.md#part-2--happy-path-literal-sweep-with-dry-run): set up the AcmeWidget fixture in TestVault; run dry-run, confirm `git status` shows no changes (SC-002); run commit, confirm 2 modified files and matching response counts; re-call and confirm `filesModified: 0` (SC-005); reset

**Checkpoint**: User Story 1 (MVP) is fully functional. The tool sweeps literal strings vault-wide with dry-run preview, against the default vault, with no skip-region or regex support yet. Linter/typecheck/build/tests all pass.

---

## Phase 4: User Story 2 - Regex with Capture Groups (Priority: P2)

**Goal**: Add regex matching with capture-group back-references (`$1`, `$&`, etc.) on top of US1's pipeline. Covers User Story 2 from [spec.md](./spec.md#user-story-2---regex-driven-rewrite-with-capture-groups-priority-p2). **Builds on** US1's pipeline — the regex extension is additive in `pattern-builder.ts` and `replacer.ts`.

**Independent Test**: Per [quickstart.md Part 4](./quickstart.md#part-4--regex-with-capture-groups-user-story-2) — feed a file containing `v1.4` and `v2.7` strings; call with `search: "v(\\d+)\\.(\\d+)"`, `replacement: "v$1.$2.0"`, `regex: true`; assert the file now contains `v1.4.0` and `v2.7.0`.

### Tests for User Story 2

- [x] T025 [P] [US2] Pattern-building regex tests in [tests/tools/find-and-replace/pattern-building.test.ts](../../tests/tools/find-and-replace/pattern-building.test.ts): regex flag set per FR-013 (`g` always-on, `i` when `caseSensitive: false`, `m` always-on, `u` always-on, `s` OFF — Q3); empty-match regex (`/^/gm`, `/(?=x)/g`) compiles successfully (Q3); `wholeWord: true` wraps the user-provided regex in `\b…\b` in regex mode (FR-010); `flexibleWhitespace: true` rewrites whitespace runs in the user-provided regex source (FR-011)
- [x] T026 [P] [US2] Schema tests for regex compile validation in [tests/tools/find-and-replace/schema.test.ts](../../tests/tools/find-and-replace/schema.test.ts): unbalanced-parenthesis pattern with `regex: true` rejected at the boundary with a structured error and identifies the bad pattern (FR-023, US2 Acceptance Scenario 2)
- [x] T027 [P] [US2] Replacer regex tests in [tests/tools/find-and-replace/replacer.test.ts](../../tests/tools/find-and-replace/replacer.test.ts): capture-group `$1`/`$2` back-references work (US2 Acceptance Scenario 1); `$&` (whole match) works; `$$` produces a literal `$`; case-insensitive regex matches mixed-case input (US2 Acceptance Scenario 3); empty-match regex with non-empty replacement applies one replacement per zero-width match position (Q3); output-size cap kicks in for unbounded growth (FR-024a `output_size_exceeded`)

### Implementation for User Story 2

- [x] T028 [US2] Extend the pattern builder in [src/tools/find-and-replace/pattern-builder.ts](../../src/tools/find-and-replace/pattern-builder.ts) with regex mode: when `regex: true`, take the user's `search` as a regex source; if `wholeWord: true`, wrap as `(?:\b)(?:${source})(?:\b)`; if `flexibleWhitespace: true`, replace whitespace runs in the source with `\s+`; compile with the FR-013 flag set: `g` + (`i` if `caseSensitive: false`) + `m` + `u`; surface `SyntaxError` from `new RegExp(...)` as a structured FR-023 error; depends on T016
- [x] T029 [US2] Extend the replacer in [src/tools/find-and-replace/replacer.ts](../../src/tools/find-and-replace/replacer.ts) for regex mode: native JS `String.prototype.replace(regex, replacement)` already honors `$1`/`$&`/`$$`; add output-size cap detection that catches the rare empty-match × non-empty-replacement explosion case before returning; depends on T017
- [x] T030 [US2] Verify the schema's regex superRefine (already wired in T005) handles US2's regex-mode inputs correctly: confirm T026 passes against the schema as it stands; if T026 reveals any gaps (e.g., a regex pattern that compiles under raw `new RegExp` but breaks under the always-on `u` flag), file the gap as a refinement to T005's superRefine in this same task. **No-op expected** — T005 should already cover FR-023 in full; this task exists only as a checkpoint that US2's test load-bears against T005's existing implementation. Depends on T026.
- [ ] T031 [US2] Manual verification per [quickstart.md Part 4](./quickstart.md#part-4--regex-with-capture-groups-user-story-2): version-string fixture; regex sweep; assert `v1.4 → v1.4.0` etc.

**Checkpoint**: User Stories 1 + 2 both functional. The tool now handles literal sweeps AND regex sweeps with capture groups.

---

## Phase 5: User Story 3 - Preserve Code Blocks and HTML Comments (Priority: P2)

**Goal**: Add the audit-trail-preservation guarantee — `skipCodeBlocks: true` and `skipHtmlComments: true` carve out fenced code blocks and HTML comments from the search; matches inside skipped regions are NOT replaced and are NOT counted in `totalReplacements` but ARE counted in `totalMatchesInSkippedRegions` for transparency. Covers User Story 3 from [spec.md](./spec.md#user-story-3---preserve-code-blocks-and-html-comments-during-sweeps-priority-p2). **Builds on** US1's pipeline.

**Independent Test**: Per [quickstart.md Part 3](./quickstart.md#part-3--audit-trail-preservation-skipcodeblocks--skiphtmlcomments) — file containing the search string in prose, in a fenced code block, and in an HTML comment; call with `skipCodeBlocks: true` and `skipHtmlComments: true`; assert the prose match is replaced and the code-block + HTML-comment bytes are byte-identical to the input; response reports `totalReplacements: 1` and `totalMatchesInSkippedRegions: 2`.

### Tests for User Story 3

- [x] T032 [P] [US3] Region-detection tests in [tests/tools/find-and-replace/region-detection.test.ts](../../tests/tools/find-and-replace/region-detection.test.ts): CommonMark fence detector (FR-007) — well-formed `\`\`\`bash`...`\`\`\``; opener with leading 0–3 spaces; opener with 4+ backticks; mismatched-count closer (3-backtick opener with 4-backtick line in middle does NOT close); unclosed fence runs to EOF (US3 Acceptance Scenario 3, FR-007); HTML comment detector (FR-008) — single-line `<!--…-->`; multi-line spanning newlines; empty `<!---->` and `<!-- -->`; unclosed `<!--` runs to EOF; non-greedy match — first `-->` closes; tilde fences (`~~~`) NOT honored; union semantics (FR-009) — comment inside code block, code block inside comment, code-block-opener inside-comment-but-closer-outside; independent detection (each detector self-contained over original content)
- [x] T033 [P] [US3] Replacer skip-region tests in [tests/tools/find-and-replace/replacer.test.ts](../../tests/tools/find-and-replace/replacer.test.ts): skip-region carve-out — pattern evaluated only against searchable spans (FR-009a); single match cannot cross a skip-region boundary (FR-009a); skip-region bytes preserved byte-for-byte across all overlap cases; `\b` boundary at skip-region edge computed against original-content edge characters (FR-009a); `matchesInSkippedRegions` count equals matches that fell inside skipped regions (FR-020b)
- [x] T034 [P] [US3] Extend the response-builder tests in [tests/tools/find-and-replace/response-builder.test.ts](../../tests/tools/find-and-replace/response-builder.test.ts) (created in T009a) with `totalMatchesInSkippedRegions` cases: aggregates correctly across multiple files; equals zero when neither skip flag is set (FR-020b); reflects only matches in original content that fell inside skipped regions (NOT counted toward `totalReplacements`). Depends on T009a.

### Implementation for User Story 3

- [x] T035 [US3] Implement the region detector in [src/tools/find-and-replace/region-detector.ts](../../src/tools/find-and-replace/region-detector.ts): export `detectFencedCodeBlocks(content: string): SkipRegion[]` per FR-007 (CommonMark line-anchored fences with up to 3 leading spaces, 3+ backticks); export `detectHtmlComments(content: string): SkipRegion[]` per FR-008 (non-greedy `<!--…-->` spanning newlines, unclosed runs to EOF); export `detectAllSkipRegions(content: string, opts: { skipCodeBlocks: boolean, skipHtmlComments: boolean }): SkipRegion[]` returning the union per FR-009 (independent detection over original content; merge sorted ranges); LAYER 2 attribution header (vaultforge — both dry-run pattern and vault-walk strategy were borrowed; this module's contribution is the region-detection variant)
- [x] T036 [US3] Extend the replacer in [src/tools/find-and-replace/replacer.ts](../../src/tools/find-and-replace/replacer.ts) to honor skip regions: if `skipRegions.length === 0`, fall back to T017's full-content path; otherwise, for each searchable span (between skip-region ranges) apply the pattern, accumulate replacements, and reassemble output by interleaving rewritten searchable spans with byte-for-byte-preserved skipped regions; never let a single match cross a span boundary (FR-009a — guaranteed by per-span evaluation); count matches that fell inside skipped regions in a separate counter for `matchesInSkippedRegions` (re-run the pattern over each skip region for counting purposes only — does NOT replace); depends on T017, T035
- [x] T037 [US3] Update the response builder in [src/tools/find-and-replace/response-builder.ts](../../src/tools/find-and-replace/response-builder.ts) to include `totalMatchesInSkippedRegions` in the aggregate; this field is always present (zero when neither skip flag is set, non-zero otherwise) per FR-020b; depends on T009
- [x] T038 [US3] Update the `rest.findAndReplace` helper in [src/services/obsidian-rest.ts](../../src/services/obsidian-rest.ts) to thread the `skipCodeBlocks` and `skipHtmlComments` flags from `RestFindAndReplaceOptions` through to `detectAllSkipRegions` and onward to the replacer; depends on T019, T035
- [ ] T039 [US3] Manual verification per [quickstart.md Part 3](./quickstart.md#part-3--audit-trail-preservation-skipcodeblocks--skiphtmlcomments): assert prose replaced, code block byte-identical, HTML comment byte-identical, response counts match expectations

**Checkpoint**: User Stories 1 + 2 + 3 functional. The tool now preserves audit-trail content (code blocks + HTML comments) when the skip flags are set, with transparency via `totalMatchesInSkippedRegions`.

---

## Phase 6: User Story 4 - Per-Vault Routing (Priority: P3)

**Goal**: Make the entire find-and-replace surface route per-vault when `vaultId` is supplied, mirroring every other multi-vault-aware tool in this fork. Covers User Story 4 from [spec.md](./spec.md#user-story-4---per-vault-routing-across-multiple-configured-vaults-priority-p3). **Builds on** US1's dispatcher — the multi-vault plumbing already exists; this story formalizes its use for `find_and_replace`.

**Independent Test**: Per [quickstart.md Part 5](./quickstart.md#part-5--multi-vault-routing-user-story-4) — set up the same fixture in `default` and `research` vaults; call with `vaultId: "research"`; assert only `research` is modified, `default` is byte-identical to before, and the response's `vaultId` field reads `"research"`.

### Tests for User Story 4

- [x] T040 [P] [US4] Multi-vault routing test in [tests/tools/find-and-replace/handler.test.ts](../../tests/tools/find-and-replace/handler.test.ts) (extends T015): when `vaultId: "research"` is supplied, the dispatcher resolves `getRestService("research")` and the helper operates on that REST service; asserts `default` vault's mocked REST service is NOT called; asserts the response's `vaultId` field reflects the resolved vault (US4 Acceptance Scenario 1, FR-017)
- [x] T041 [P] [US4] Invalid `vaultId` test in [tests/tools/find-and-replace/handler.test.ts](../../tests/tools/find-and-replace/handler.test.ts): when `vaultId: "no-such-vault"`, the dispatcher's `getRestService` throws; the tool returns a structured error with zero files written (US4 Acceptance Scenario 2, FR-019)

### Implementation for User Story 4

- [x] T042 [US4] Verify the dispatcher's vault resolution behavior — **no new code expected**. The `case 'find_and_replace'` branch from T022 already calls `this.getRestService(this.resolveVaultId(args))`, and `getRestService` already throws `Error("Vault \"<id>\" is not configured")` on unknown vaults (see [src/index.ts](../../src/index.ts) line 86–93, the established pattern shared with every other multi-vault-aware tool). The dispatcher's outer try/catch in [src/index.ts](../../src/index.ts) converts that thrown error to a structured MCP error per FR-019. Confirm via T041's test that this path still works for `find_and_replace`. If T041 fails, the gap is in the dispatcher's existing error-conversion logic (out of scope for this feature) — escalate. Depends on T022, T041.
- [x] T043 [US4] Update the handler / response builder to populate the `vaultId` field on the response per [data-model.md §5](./data-model.md#5-findandreplaceresult-response-shape): the resolved vault id (whatever the dispatcher chose, default or explicit) is echoed in the response so clients know which vault they hit; depends on T020, T009
- [ ] T044 [US4] Manual verification per [quickstart.md Part 5](./quickstart.md#part-5--multi-vault-routing-user-story-4): two-vault setup, call with `vaultId: "research"`, confirm `default` untouched, `research` modified

**Checkpoint**: All four user stories functional. The tool is feature-complete per the spec.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Finalize attribution, end-to-end verification, and PR-readiness.

- [x] T045 [P] Add the attributions section to [README.md](../../README.md) per [research.md §R14](./research.md#r14--attribution-readme-addition-fr-028) (FR-028): name `cyanheads/obsidian-mcp-server` (LAYER 1), `blacksmithers/vaultforge` (LAYER 2), and the project's LAYER 3 original-contribution wrapper; record verified license SPDX IDs from T001/T002
- [ ] T046 [P] Manual verification per [quickstart.md Part 6](./quickstart.md#part-6--cross-platform-line-ending-preservation-fr-016a): CRLF-fixture round-trip; assert `git diff --stat` shows only the actual replacements, NOT every line (proves FR-016a)
- [ ] T047 [P] Manual verification per [quickstart.md Part 7](./quickstart.md#part-7--per-file-size-cap-fr-024a--sc-009): 6 MB BigFile fixture + small companion; assert BigFile lands in `skipped` with `size_exceeded` and is NOT modified; small companion IS modified
- [x] T048 Run the full quality gates: `npm run lint && npm run typecheck && npm run build && npm test` all pass with zero warnings; per Constitution §3 Quality Gates 1–4
- [x] T048a [P] **SC-001 performance benchmark** in [tests/tools/find-and-replace/benchmark.test.ts](../../tests/tools/find-and-replace/benchmark.test.ts) (or as a `vitest` `bench`-style test if available): construct a synthetic 1,000-`.md`-file mocked vault (mocked `ObsidianRestService` with stubbed REST calls returning small note bodies); run a literal sweep with `dryRun: true` followed by `dryRun: false`; assert total wall-time under 30 seconds (SC-001). Mark the test as a smoke benchmark (skip in CI if the runner is too slow; the assertion is informational against a generous bound rather than a tight perf gate). Records the actual time so regressions are visible in test logs.
- [x] T049 Update [research.md §R1](./research.md#r1--cyanheadsobsidian-mcp-server-license-verification-layer-1-attribution) and [§R2](./research.md#r2--blacksmithersvaultforge-license-verification-layer-2-attribution) with the verified license SPDX IDs (replacing the `[verified at implementation time]` placeholders); cross-link the attributions section in README and the source-header attributions to the verified IDs

**Final Checkpoint**: Feature ready for PR. Quality gates green. Attribution complete. Quickstart parts 2–7 manually verified.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies. T001/T002 are merge-blocking.
- **Foundational (Phase 2)**: Depends on Setup. **BLOCKS all user stories.**
- **US1 (Phase 3)**: Depends on Foundational. **MVP.**
- **US2 (Phase 4)**: Depends on Foundational + US1. (Extends `pattern-builder.ts` and `replacer.ts` from US1.)
- **US3 (Phase 5)**: Depends on Foundational + US1. (Extends `replacer.ts`, `response-builder.ts`, `rest.findAndReplace` helper from US1.)
- **US4 (Phase 6)**: Depends on Foundational + US1. (Extends the dispatcher hook and handler from US1; the multi-vault plumbing itself is already in place.)
- **Polish (Phase 7)**: Depends on US1 (mandatory). T045–T047 can run after any subset of US2/US3/US4 lands; T048/T049 must wait until the final user story being shipped is done.

### User Story Dependencies — honest reading

The four user stories are NOT fully independent. US2/US3/US4 are additive enhancements that build on US1's pipeline:

- **US1 alone** is a shippable MVP — literal sweep, dry-run, default vault. Useful on its own.
- **US2 = US1 + regex** — extends `pattern-builder.ts` and `replacer.ts` with regex-mode logic. Cannot ship without US1's literal-mode infrastructure.
- **US3 = US1 + skip regions** — extends `replacer.ts` and the response with region detection. Cannot ship without US1's replacement pipeline.
- **US4 = US1 + multi-vault** — extends the dispatcher / handler with vaultId routing. Cannot ship without US1's tool registration and dispatcher hook.

This is a normal pattern — the MVP IS the integrated pipeline, and the additional stories are flag-gated additions, not parallel features. The phase ordering reflects this: each phase builds on the previous one's modules.

### Within Each User Story

- Tests SHOULD be written first (TDD), or at minimum land in the same commit as the implementation per Constitution Principle II.
- Within a phase, tasks marked [P] touch different files and can run in parallel.
- Tasks NOT marked [P] either modify a shared file (sequenced naturally) or have a documented data dependency on a prior task.

### Parallel Opportunities

**Within Phase 1 (Setup)**: T001, T002, T003 are all [P] — independent file/system checks.

**Within Phase 2 (Foundational)**: T005 ↔ T006, T007 ↔ T008 form (impl, test) pairs. T005 is sequential (defines the schema); T006 is [P] on tests. T007 sequential, T008 [P]. T009 sequential.

**Within Phase 3 (US1)**:
- All tests (T010–T015) are [P] — different test files.
- T016, T017, T018 are [P] — different source files (pattern-builder, replacer, preview-formatter).
- T021 is [P] with T016/T017/T018 (different file: tool.ts).
- T019 depends on T016+T017+T018 — sequenced.
- T020 depends on T019 — sequenced.
- T022 depends on T020 — sequenced.
- T023 depends on T021 — sequenced.

**Within Phase 4 (US2)**: T025, T026, T027 [P]. T028 (pattern-builder) extends T016 — sequenced. T029 (replacer) extends T017 — sequenced. T030 (schema) extends T005 — sequenced.

**Within Phase 5 (US3)**: T032, T033, T034 [P]. T035 (region-detector) is a new file — can run independently. T036 (replacer) extends T017+T029 — sequenced.

**Within Phase 6 (US4)**: T040, T041 [P]. T042 (dispatcher) is a one-line edit on existing branch from T022.

**Within Phase 7 (Polish)**: T045, T046, T047 [P].

---

## Parallel Example: User Story 1 Tests

```text
# Run all five US1 test files in parallel (each is a different file):
- tests/tools/find-and-replace/pattern-building.test.ts (T010)
- tests/tools/find-and-replace/replacer.test.ts (T011)
- tests/tools/find-and-replace/preview-formatter.test.ts (T012)
- tests/services/find-and-replace/rest-find-and-replace.test.ts (T013)
- tests/tools/find-and-replace/registration.test.ts (T014)

# Implementation files for US1 (the three core modules):
- src/tools/find-and-replace/pattern-builder.ts (T016)
- src/tools/find-and-replace/replacer.ts (T017)
- src/tools/find-and-replace/preview-formatter.ts (T018)
- src/tools/find-and-replace/tool.ts (T021)
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Phase 1 (Setup): T001 → T002 → T003 → T004.
2. Phase 2 (Foundational): T005 + T006, T007 + T008, T009.
3. Phase 3 (US1): T010–T015 (tests), then T016 + T017 + T018 + T021 in parallel, then T019 → T020 → T022 → T023, then T024 (manual verification).
4. **STOP and VALIDATE**: Run [quickstart.md Part 2](./quickstart.md#part-2--happy-path-literal-sweep-with-dry-run) end-to-end. If green, the MVP is shippable.
5. **Decision point**: ship the MVP as a single PR (gives users literal sweep + dry-run + multi-vault default-routing), then layer US2/US3/US4 in follow-on PRs; OR continue to Phase 4–7 and ship the full feature as one PR.

### Incremental Delivery (recommended for review tractability)

1. PR 1: Phases 1 + 2 + 3 (foundational + US1 MVP). ~25 tasks, reviewable in a single sitting.
2. PR 2: Phase 4 (US2 regex). ~7 tasks.
3. PR 3: Phase 5 (US3 skip regions). ~8 tasks.
4. PR 4: Phase 6 (US4 multi-vault) + Phase 7 (polish). ~10 tasks.

This sequence keeps each PR small and lets US1 ship fast while US2/US3/US4 land iteratively.

### Single-PR Delivery

If preferred, ship all 49 tasks in one PR. The phase ordering in this file is the recommended commit sequence; each phase's checkpoint is a natural commit boundary.

---

## Notes

- **Tests are mandatory** (Principle II), not optional. Tests for each user story land in the same commit as the implementation, OR are written first (TDD) and ensured to fail before the implementation lands.
- The `[Story]` label maps tasks to user stories for traceability and parallel-team coordination.
- `[P]` markers are advisory in a single-developer workflow; they signal where tasks could be safely parallelized.
- Each user story phase ends with a manual quickstart verification (T024, T031, T039, T044). These are not automated; the reviewer or implementer runs them by hand against TestVault.
- License-verification gates (T001, T002) are MERGE-BLOCKING — do not skip.
- 012's `rename_file` re-enable is **OUT OF SCOPE for this feature**, tracked in [012's tasks file](../012-safe-rename/tasks.md) and unblocked by this feature's merge.

## Validation summary

- **Total tasks**: 51 (T001–T049 plus T009a and T048a).
- **Per phase**: Setup 4 (T001–T004); Foundational 6 (T005–T009 + T009a); US1 15 (T010–T024); US2 7 (T025–T031); US3 8 (T032–T039); US4 5 (T040–T044); Polish 6 (T045–T049 + T048a).
- **Per user story**: US1 = 15 tasks (P1, MVP); US2 = 7 tasks (P2); US3 = 8 tasks (P2); US4 = 5 tasks (P3).
- **Format check**: every task starts with `- [ ]`, has a sequential ID (`T###` or `T###a` for inserted-after-the-fact tasks), has a [P] marker iff parallelizable, has a [Story] label iff in a user-story phase (Phases 3–6), and includes a concrete file path (or repo-level scope for setup / verification tasks).
- **Independent test criteria**: each user story phase documents an independent test linked to the spec's User Story acceptance scenarios and the quickstart's Part-N section.
- **Suggested MVP scope**: Phases 1 + 2 + 3 (User Story 1 only — literal sweep with dry-run, default vault). 25 tasks.
