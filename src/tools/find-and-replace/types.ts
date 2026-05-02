/**
 * find_and_replace tool: shared type definitions.
 *
 * Mirrors specs/013-find-and-replace/data-model.md §2–§6 — the
 * non-request, non-result internal record shapes plus the public
 * result and helper-options shapes.
 */

/** A skip region carved out of a note's content (FR-007 / FR-008 / FR-009). */
export interface SkipRegion {
  /** Inclusive start index in JS code units. */
  start: number;
  /** Exclusive end index in JS code units. */
  end: number;
  /** Detector that produced the region; used for diagnostics + accounting. */
  kind: 'code-block' | 'html-comment';
}

/** A structured match preview entry (FR-015). */
export interface MatchPreview {
  matchIndex: number;
  lineNumber: number;
  columnStart: number;
  before: string;
  match: string;
  replacement: string;
  after: string;
}

/** Per-file outcome categorisation. */
export type PerFileOutcome = 'modified' | 'no-op' | 'skipped' | 'failed';

/** Reason a file landed in the response's `skipped` array. */
export type SkipReason = 'size_exceeded' | 'output_size_exceeded';

/** Internal accounting record produced by the file processor for each file. */
export interface PerFileResult {
  filename: string;
  replacements: number;
  matchesInSkippedRegions: number;
  previews?: MatchPreview[];
  outcome: PerFileOutcome;
  skipReason?: SkipReason;
  error?: string;
  inputSizeBytes: number;
  outputSizeBytes: number;
}

/** Public response entry for a successfully processed file (verbose mode). */
export interface PerFileResponseEntry {
  filename: string;
  replacements: number;
  matchesInSkippedRegions: number;
  previews?: MatchPreview[];
  outcome: PerFileOutcome;
}

/** Public response entry for a per-file failure (FR-021a). */
export interface FailureEntry {
  filename: string;
  error: string;
}

/** Public response entry for a per-file skip (FR-024a). */
export interface SkippedEntry {
  filename: string;
  reason: SkipReason;
  sizeBytes: number;
  outputSizeBytes?: number;
}

/** Aggregate response shape returned by the helper and the public tool. */
export interface FindAndReplaceResult {
  ok: boolean;
  dryRun: boolean;
  vaultId: string;
  pathPrefix: string | null;
  filesScanned: number;
  filesModified: number;
  filesSkipped: number;
  totalReplacements: number;
  totalMatchesInSkippedRegions: number;
  perFile?: PerFileResponseEntry[];
  failures?: FailureEntry[];
  skipped?: SkippedEntry[];
  responseTruncated?: boolean;
}

/**
 * The vault-agnostic options bag accepted by the
 * `ObsidianRestService.findAndReplace` helper. Mirror of
 * `FindAndReplaceRequest` minus `vaultId` (the per-vault routing axis
 * is the REST instance the helper is called on).
 */
export interface RestFindAndReplaceOptions {
  search: string;
  replacement: string;
  regex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  flexibleWhitespace?: boolean;
  skipCodeBlocks?: boolean;
  skipHtmlComments?: boolean;
  dryRun?: boolean;
  pathPrefix?: string;
  verbose?: boolean;
}
