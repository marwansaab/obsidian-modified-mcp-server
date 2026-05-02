# Quickstart: `find_and_replace` end-to-end verification

**Branch**: `013-find-and-replace` | **Date**: 2026-05-03 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Contract**: [contracts/find_and_replace.md](./contracts/find_and_replace.md)

This document is the manual / scripted verification path for `find_and_replace`. Automated unit tests (per Principle II + the test contract) cover semantics; this quickstart covers the end-to-end behavior that's hard to mock — actual REST round-trips against a real vault, cross-platform line-ending preservation, and the multi-vault routing path.

Run this checklist on the implementer's branch before requesting review, and again on the reviewer's machine before merging.

## Prerequisites

1. **Test vault**. A scratch Obsidian vault — recommended path: `~/Vaults/TestVault/`. The vault SHOULD be a fresh git repository (so `git status` is the visible safety net per FR-003a).
2. **Obsidian + Local REST API plugin** running on the test vault. The plugin's API key is in `config/vaults.json` under the test vault's entry.
3. **Multi-vault config**. At least two vaults configured: `default` and `research` (or similar). Both running. Both registered in `config/vaults.json`.
4. **Build is clean**. `npm install`, `npm run lint`, `npm run typecheck`, `npm run build`, `npm test` all pass before starting.

## Part 1 — License verification (R1, R2)

**Block the merge until both checks pass.**

```bash
# R1: cyanheads/obsidian-mcp-server license
curl -s https://api.github.com/repos/cyanheads/obsidian-mcp-server | jq -r '.license.spdx_id'
# Expected: MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, or ISC.
# If any other value: STOP. Pivot to "inspired by" attribution and remove any
# code-pattern lifts. Document the decision in research.md §R1.

# R2: blacksmithers/vaultforge license
curl -s https://api.github.com/repos/blacksmithers/vaultforge | jq -r '.license.spdx_id'
# Expected: same permissive set.
# Same fallback rule.
```

Record the verified license IDs in `research.md §R1` and `§R2` (replace the `[verified at implementation time]` placeholders).

## Part 2 — Happy path: literal sweep with dry-run

Set up a known fixture in the test vault:

```bash
# In TestVault root:
mkdir -p Projects/AcmeWidget
cat > Projects/AcmeWidget/notes.md << 'EOF'
# AcmeWidget Notes

The AcmeWidget project ships next quarter.

```bash
echo "AcmeWidget"  # this is in a code block — should NOT be replaced when skipCodeBlocks: true
```

<!-- renamed from FrobnicatorPro on 2025-12-01: AcmeWidget -->
EOF

cat > NotesAboutAcmeWidget.md << 'EOF'
AcmeWidget is the codename for our next launch.
EOF

cd TestVault && git init && git add . && git commit -m "fixture"
```

Invoke the tool from an MCP client (or via direct dispatcher call in a test harness):

### 2a — Dry-run (must NOT write)

**Request:**
```json
{
  "name": "find_and_replace",
  "arguments": {
    "search": "AcmeWidget",
    "replacement": "Globex",
    "dryRun": true,
    "verbose": true
  }
}
```

**Expected response:**
- `ok: true`
- `dryRun: true`
- `filesScanned >= 2`
- `filesModified === 2` (the two files containing the literal)
- `totalReplacements >= 3` (one in each of the prose lines, plus the comment)
- `totalMatchesInSkippedRegions === 0` (we didn't set skip flags)
- `filesSkipped === 0`
- `perFile` array contains the two files, sorted by filename ascending: `NotesAboutAcmeWidget.md` first, then `Projects/AcmeWidget/notes.md`.
- Each `perFile[i].previews` has 1–3 entries with the `MatchPreview` shape from the data model.

**Verification:**
```bash
cd TestVault && git status
# Expected: nothing to commit, working tree clean (FR-015, SC-002)
```

If `git status` shows ANY changes after a dry-run, the tool is violating FR-015 — **STOP and fix before proceeding**.

### 2b — Commit run (writes)

Repeat the call with `dryRun: false`:

```json
{
  "name": "find_and_replace",
  "arguments": {
    "search": "AcmeWidget",
    "replacement": "Globex",
    "dryRun": false,
    "verbose": true
  }
}
```

**Expected response:**
- Same counts as the dry-run.
- `dryRun: false`.

**Verification:**
```bash
cd TestVault && git status
# Expected: 2 modified files
git diff
# Expected: every "AcmeWidget" in the prose AND in the comment is now "Globex".
# The line inside the ``` ... ``` code block IS replaced (we didn't set skipCodeBlocks).
```

### 2c — Re-call (idempotency check, SC-005)

Call again with the same arguments and `dryRun: false`:

**Expected response:**
- `filesModified === 0`
- `totalReplacements === 0`

This proves SC-005: a sweep that found N matches the first time finds 0 the second time, because the literal `AcmeWidget` is no longer in the vault.

```bash
cd TestVault && git status
# Expected: still the 2 modified files from 2b — nothing new to commit.
```

Reset before continuing:
```bash
cd TestVault && git restore .
```

## Part 3 — Audit-trail preservation: skipCodeBlocks + skipHtmlComments

Re-use the Part 2 fixture (after `git restore .` so the file is back to original). Call:

```json
{
  "name": "find_and_replace",
  "arguments": {
    "search": "AcmeWidget",
    "replacement": "Globex",
    "skipCodeBlocks": true,
    "skipHtmlComments": true,
    "dryRun": false
  }
}
```

**Expected response:**
- `filesModified >= 1` (the prose lines are replaced).
- `totalReplacements >= 2` (prose lines only — the code-block line and the comment line are skipped).
- `totalMatchesInSkippedRegions === 2` (one in code block, one in comment — proves FR-020b transparency works).

**Verification:**
```bash
cd TestVault && git diff Projects/AcmeWidget/notes.md
# Expected: the prose line "The AcmeWidget project..." → "The Globex project..."
# Expected: the line `echo "AcmeWidget"` inside ```...``` is UNCHANGED.
# Expected: the comment `<!-- renamed from FrobnicatorPro on ...: AcmeWidget -->` is UNCHANGED.
```

This is the audit-trail-preservation guarantee from User Story 3 / SC-003. **If the code block or HTML comment was modified, FR-007 / FR-008 are broken — STOP and fix.**

## Part 4 — Regex with capture groups (User Story 2)

Reset:
```bash
cd TestVault && git restore .
cat > VersionsLog.md << 'EOF'
- v1.4 — initial release
- v2.7 — feature drop
- v3.0 — refactor
EOF
git add VersionsLog.md && git commit -m "version fixture"
```

Call:
```json
{
  "name": "find_and_replace",
  "arguments": {
    "search": "v(\\d+)\\.(\\d+)",
    "replacement": "v$1.$2.0",
    "regex": true,
    "dryRun": false
  }
}
```

**Expected response:**
- `filesModified === 1`.
- `totalReplacements === 3`.

**Verification:**
```bash
cd TestVault && cat VersionsLog.md
# Expected:
# - v1.4.0 — initial release
# - v2.7.0 — feature drop
# - v3.0.0 — refactor
```

## Part 5 — Multi-vault routing (User Story 4)

Set up the same fixture in BOTH the `default` vault and the `research` vault. Then call with `vaultId: "research"`:

```json
{
  "name": "find_and_replace",
  "arguments": {
    "search": "AcmeWidget",
    "replacement": "Globex",
    "vaultId": "research",
    "dryRun": false
  }
}
```

**Expected response:**
- The response's `vaultId` field shows `"research"`.
- `filesModified` reflects the matches in the research vault only.

**Verification:**
```bash
cd ~/Vaults/research && git status
# Expected: modified files (the Globex rewrites).

cd ~/Vaults/default && git status
# Expected: NOTHING modified — clean tree.
```

This is FR-017 / SC-004. **If the default vault was modified, the LAYER 3 routing is broken — STOP.**

Reset both vaults:
```bash
cd ~/Vaults/research && git restore .
cd ~/Vaults/default && git restore .
```

## Part 6 — Cross-platform line-ending preservation (FR-016a)

Reset the test vault. Create a CRLF-encoded file:

**On Linux/macOS:**
```bash
cd TestVault && printf "Line one with AcmeWidget\r\nLine two with AcmeWidget\r\nLine three\r\n" > CrlfFile.md
git add CrlfFile.md && git commit -m "CRLF fixture"

# Verify it's CRLF before the call:
file CrlfFile.md
# Expected output mentions "with CRLF line terminators"
```

Call:
```json
{
  "name": "find_and_replace",
  "arguments": {
    "search": "AcmeWidget",
    "replacement": "Globex"
  }
}
```

**Verification:**
```bash
cd TestVault && file CrlfFile.md
# Expected: STILL "with CRLF line terminators"

git diff --stat CrlfFile.md
# Expected: 1 file changed, 2 insertions(+), 2 deletions(-) — i.e., only the AcmeWidget→Globex
# replacements show as diffs, NOT every line.

# Detailed diff sanity:
git diff CrlfFile.md
# Expected: a single hunk showing two specific replacements; NO mass-line-ending changes
# (which would indicate normalization broke FR-016a).
```

If `git diff` shows every line as modified, line endings were normalized — **FR-016a is broken. STOP.**

## Part 7 — Per-file size cap (FR-024a + SC-009)

```bash
cd TestVault
# Generate a 6 MB file:
yes "AcmeWidget appears here" | head -n 200000 > BigFile.md
git add BigFile.md && git commit -m "big fixture"
ls -la BigFile.md
# Expected: ~6 MB

# Generate a small companion file with matches:
echo "AcmeWidget" > SmallFile.md
git add SmallFile.md && git commit -m "small fixture"
```

Call:
```json
{
  "name": "find_and_replace",
  "arguments": {
    "search": "AcmeWidget",
    "replacement": "Globex"
  }
}
```

**Expected response:**
- `filesModified === 1` (SmallFile.md).
- `filesSkipped === 1` (BigFile.md).
- `skipped: [{ filename: "BigFile.md", reason: "size_exceeded", sizeBytes: ~6*1024*1024 }]`.

**Verification:**
```bash
cd TestVault && git status
# Expected: SmallFile.md modified; BigFile.md UNCHANGED.

git diff BigFile.md
# Expected: empty (no changes).
```

This is FR-024a + SC-009. **If BigFile.md was modified, the input size cap is broken. STOP.**

## Part 8 — Mid-sweep failure (FR-021a)

This case is hard to trigger end-to-end without inducing an actual REST API failure. The integration story:

- The unit test `tests/tools/find-and-replace/handler.test.ts` covers this with a mocked `ObsidianRestService` whose `putContent` rejects on the second file.
- For a real-world manual repro, temporarily revoke the test vault's API key in `config/vaults.json` *while a sweep is in progress* — the second-and-onward `putContent` calls fail.

**Expected behavior** (from the unit test, which is authoritative):
- The sweep continues past the first failure.
- The response has `ok: false`.
- `filesModified` reflects whatever was successfully written before the failure(s).
- `failures: [{ filename, error }, ...]` lists the failed files with their upstream error message.

This is FR-021a. The unit test is the canonical verification — repeat manual repro is optional and noisy.

## Part 9 — Documentation deliverables

Before requesting merge, confirm:

- [ ] `README.md` has the new "Attributions" section (or extension) per [research.md §R14](./research.md#r14--attribution-readme-addition-fr-028).
- [ ] Source-header attributions present in:
  - `src/tools/find-and-replace/pattern-builder.ts` (LAYER 1, cyanheads)
  - `src/tools/find-and-replace/replacer.ts` (LAYER 1, cyanheads)
  - `src/tools/find-and-replace/region-detector.ts` (LAYER 2, vaultforge)
  - `src/tools/find-and-replace/preview-formatter.ts` (LAYER 2, vaultforge)
  - `src/tools/find-and-replace/walker.ts` (LAYER 3 — project, with vault-walk-strategy credit to vaultforge per R2)
  - `src/tools/find-and-replace/response-builder.ts` (LAYER 3 — project original)
  - `src/services/obsidian-rest.ts` `findAndReplace` method (LAYER 3 routing surface)
- [ ] [research.md §R1](./research.md#r1--cyanheadsobsidian-mcp-server-license-verification-layer-1-attribution) and [§R2](./research.md#r2--blacksmithersvaultforge-license-verification-layer-2-attribution) have the verified license IDs replacing the `[verified at implementation time]` placeholders.
- [ ] CLAUDE.md `<!-- SPECKIT START -->` block points to this feature's plan.
- [ ] All test files exist and pass (`npm test`).

## Part 10 — Downstream unblock check

After this feature merges, the following 012 work becomes unblocked:

- [ ] 012's `RENAME_FILE_TOOLS` is restored to `ALL_TOOLS` in [src/tools/index.ts](../../../src/tools/index.ts).
- [ ] 012's `handler.ts` is implemented (it imports `rest.findAndReplace` per the contract above).
- [ ] 012's tests are completed and pass.
- [ ] 012's quickstart Part 2 (E2E) runs clean.

This is **out of scope for this feature's merge** but worth tracking — when a future PR enables 012's handler, it should reference commit `[hash of this feature's merge commit]` as the unblocker.
