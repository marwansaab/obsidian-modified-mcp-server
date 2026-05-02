/**
 * find_and_replace tool: response builder.
 *
 * Aggregates an array of PerFileResult records into the public
 * FindAndReplaceResult shape (specs/013-find-and-replace/data-model.md §5).
 * Handles FR-020c canonical sort order across `perFile`, `failures`,
 * and `skipped` arrays, and applies the R16 1 MB total-response cap.
 *
 * LAYER 3 — Multi-vault dispatch wrapper. Original contribution of
 * this project. Distinguishes this fork's find-and-replace from the
 * upstream sources (cyanheads/obsidian-mcp-server, blacksmithers/vaultforge,
 * MCPVault) — none of which provides multi-vault routing. The response's
 * `vaultId` field is part of that contribution: it makes the resolved
 * vault unambiguous to the caller without re-resolving.
 */

import type {
  FailureEntry,
  FindAndReplaceResult,
  PerFileResponseEntry,
  PerFileResult,
  SkippedEntry,
} from './types.js';

/** R16 — total response body cap (JSON-stringified) to keep MCP messages bounded. */
const RESPONSE_CAP_BYTES = 1 * 1024 * 1024;

/** Lexicographic UTF-8 ascending compare, FR-020c. */
function byFilenameAsc<T extends { filename: string }>(a: T, b: T): number {
  return a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0;
}

interface AssembleInput {
  perFileResults: PerFileResult[];
  resolvedVaultId: string;
  pathPrefix: string | null;
  dryRun: boolean;
  verbose: boolean;
}

/**
 * Assemble the aggregate response from per-file records.
 *
 * Empty arrays (`failures`, `skipped`, `perFile`) are omitted entirely
 * to reduce noise on the happy path.
 */
export function assembleResult(input: AssembleInput): FindAndReplaceResult {
  const { perFileResults, resolvedVaultId, pathPrefix, dryRun, verbose } = input;

  let filesScanned = 0;
  let filesModified = 0;
  let filesSkipped = 0;
  let totalReplacements = 0;
  let totalMatchesInSkippedRegions = 0;
  const perFile: PerFileResponseEntry[] = [];
  const failures: FailureEntry[] = [];
  const skipped: SkippedEntry[] = [];

  for (const r of perFileResults) {
    // `filesScanned` counts files we actually fetched and considered for
    // replacement — i.e., everything except dot-prefix-excluded (which
    // never become PerFileResult records) and size-skipped files (which
    // were not processed). Modified, no-op, and failed files all count.
    if (r.outcome !== 'skipped') {
      filesScanned += 1;
    }

    switch (r.outcome) {
      case 'modified':
        filesModified += 1;
        totalReplacements += r.replacements;
        totalMatchesInSkippedRegions += r.matchesInSkippedRegions;
        if (verbose) {
          perFile.push(toResponseEntry(r));
        }
        break;
      case 'no-op':
        totalMatchesInSkippedRegions += r.matchesInSkippedRegions;
        if (verbose) {
          perFile.push(toResponseEntry(r));
        }
        break;
      case 'skipped':
        filesSkipped += 1;
        skipped.push({
          filename: r.filename,
          reason: r.skipReason ?? 'size_exceeded',
          sizeBytes: r.inputSizeBytes,
          ...(r.skipReason === 'output_size_exceeded'
            ? { outputSizeBytes: r.outputSizeBytes }
            : {}),
        });
        break;
      case 'failed':
        failures.push({ filename: r.filename, error: r.error ?? 'Unknown error' });
        break;
    }
  }

  perFile.sort(byFilenameAsc);
  failures.sort(byFilenameAsc);
  skipped.sort(byFilenameAsc);

  const result: FindAndReplaceResult = {
    ok: failures.length === 0,
    dryRun,
    vaultId: resolvedVaultId,
    pathPrefix,
    filesScanned,
    filesModified,
    filesSkipped,
    totalReplacements,
    totalMatchesInSkippedRegions,
  };

  if (verbose && perFile.length > 0) {
    result.perFile = perFile;
  }
  if (failures.length > 0) {
    result.failures = failures;
  }
  if (skipped.length > 0) {
    result.skipped = skipped;
  }

  return applyResponseCap(result);
}

function toResponseEntry(r: PerFileResult): PerFileResponseEntry {
  const entry: PerFileResponseEntry = {
    filename: r.filename,
    replacements: r.replacements,
    matchesInSkippedRegions: r.matchesInSkippedRegions,
    outcome: r.outcome,
  };
  if (r.previews && r.previews.length > 0) {
    entry.previews = r.previews;
  }
  return entry;
}

/**
 * R16 response-size cap. If the JSON-serialised result exceeds 1 MB,
 * drop the lowest-impact `perFile` entries (smallest replacement count
 * first) until the response fits, and set `responseTruncated: true`.
 *
 * Two-step algorithm to keep this O(N) instead of the naive O(N²):
 *   1. Compute the size budget for the perFile array by subtracting
 *      the skeleton (everything except perFile) from the cap.
 *   2. Walk the entries (sorted by impact descending) and accumulate
 *      until the budget is exhausted, then return the accumulated set
 *      sorted by filename ascending per FR-020c.
 */
function applyResponseCap(result: FindAndReplaceResult): FindAndReplaceResult {
  if (!result.perFile || result.perFile.length === 0) {
    return result;
  }
  const fullSerialized = JSON.stringify(result);
  if (Buffer.byteLength(fullSerialized, 'utf8') <= RESPONSE_CAP_BYTES) {
    return result;
  }

  // Skeleton = the result minus perFile, with responseTruncated set so
  // the size budget reflects the truncated form's overhead.
  const skeleton: FindAndReplaceResult = { ...result, perFile: undefined, responseTruncated: true };
  const skeletonBytes = Buffer.byteLength(JSON.stringify(skeleton), 'utf8');

  // The two characters `,` and the array brackets `[]` plus comma
  // separators between elements are the only structural overhead
  // beyond skeleton + per-entry serialization. Approximate by 16 bytes
  // headroom, conservative.
  const overheadBytes = 16;
  let remaining = RESPONSE_CAP_BYTES - skeletonBytes - overheadBytes;
  if (remaining <= 0) {
    return skeleton;
  }

  // Sort by replacement count descending — keep most-impactful entries
  // first; cheaper to evict low-impact entries.
  const sortedByImpact = [...result.perFile].sort(
    (a, b) => b.replacements - a.replacements,
  );

  const kept: typeof sortedByImpact = [];
  for (const entry of sortedByImpact) {
    const entrySize = Buffer.byteLength(JSON.stringify(entry), 'utf8') + 1; // +1 for comma
    if (entrySize > remaining) break;
    kept.push(entry);
    remaining -= entrySize;
  }

  if (kept.length === 0) {
    return skeleton;
  }

  return {
    ...skeleton,
    perFile: kept.sort(byFilenameAsc),
  };
}
