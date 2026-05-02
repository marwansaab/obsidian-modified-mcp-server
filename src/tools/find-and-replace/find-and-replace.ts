/**
 * find_and_replace tool: workhorse helper.
 *
 * The `runFindAndReplace(rest, opts)` function composes the foundational
 * + per-note + composition layers into the public result. It is the
 * implementation backend for both:
 *   (a) the public MCP tool `find_and_replace` (via handler.ts), and
 *   (b) the internal `ObsidianRestService.findAndReplace(opts)` method
 *       (via obsidian-rest.ts).
 *
 * 012's `rename_file` handler imports the latter once 012 ships;
 * see specs/012-safe-rename/plan.md "Implementation order constraint".
 *
 * LAYER 3 — Multi-vault dispatch wrapper. Original contribution of
 * this project. The vault-agnostic helper boundary (no `vaultId`
 * parameter — routing happens by which `rest` instance the caller
 * holds) is the LAYER 3 contribution per FR-027 and
 * specs/013-find-and-replace/research.md §R8.
 */

import { buildPattern } from './pattern-builder.js';
import { buildPreviews } from './preview-formatter.js';
import { detectAllSkipRegions } from './region-detector.js';
import { applyReplacement } from './replacer.js';
import { assembleResult } from './response-builder.js';
import { walkVault } from './walker.js';

import type {
  FindAndReplaceResult,
  PerFileResult,
  RestFindAndReplaceOptions,
  SkipRegion,
} from './types.js';
import type { ObsidianRestService } from '../../services/obsidian-rest.js';

/**
 * Per-file size cap in bytes (FR-024a). Applied to BOTH input and
 * output. 5 MB.
 */
const FILE_SIZE_CAP_BYTES = 5 * 1024 * 1024;

/**
 * Strip a single trailing slash if present. Mirrors walker's util.
 */
function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

/**
 * Execute the find-and-replace sweep against the supplied per-vault
 * REST service. The `rest` instance dictates which vault is mutated
 * (LAYER 3 routing). The helper itself is vault-agnostic at its
 * boundary.
 *
 * @param rest          per-vault REST client (already resolved by caller)
 * @param opts          replacement options (no vaultId field; see R8)
 * @param resolvedVaultId the vault id the caller resolved via getRestService;
 *                       echoed in the response per FR-018 / data-model §5.
 *                       The default-vault path passes the resolved default id here.
 */
export async function runFindAndReplace(
  rest: ObsidianRestService,
  opts: RestFindAndReplaceOptions,
  resolvedVaultId: string,
): Promise<FindAndReplaceResult> {
  // Helper-level backstop validation (Principle III; the public-tool
  // boundary already validates via zod, but 012 may call us directly).
  if (!opts.search || opts.search.length === 0) {
    throw new Error('search must be non-empty');
  }
  if (opts.regex) {
    // Throwing here surfaces FR-023 to direct callers; the public
    // tool's zod schema catches it earlier with a field path.
     
    new RegExp(opts.search, opts.caseSensitive === false ? 'gimu' : 'gmu');
  }

  const search = opts.search;
  const replacement = opts.replacement;
  const regex = opts.regex ?? false;
  const caseSensitive = opts.caseSensitive ?? true;
  const wholeWord = opts.wholeWord ?? false;
  const flexibleWhitespace = opts.flexibleWhitespace ?? false;
  const skipCodeBlocks = opts.skipCodeBlocks ?? false;
  const skipHtmlComments = opts.skipHtmlComments ?? false;
  const dryRun = opts.dryRun ?? false;
  const verbose = opts.verbose ?? false;
  const pathPrefix =
    opts.pathPrefix !== undefined ? stripTrailingSlash(opts.pathPrefix) : undefined;

  const compiledPattern = buildPattern({
    search,
    replacement,
    regex,
    caseSensitive,
    wholeWord,
    flexibleWhitespace,
  });

  // LAYER 3 vault enumeration. May throw if the REST API is offline
  // or the vault is unreachable — that error propagates per Principle IV.
  const files = await walkVault(rest, pathPrefix);

  const perFileResults: PerFileResult[] = [];

  for (const filename of files) {
    const result = await processOneFile({
      rest,
      filename,
      compiledPattern,
      replacement,
      skipCodeBlocks,
      skipHtmlComments,
      dryRun,
      verbose,
    });
    perFileResults.push(result);
  }

  return assembleResult({
    perFileResults,
    resolvedVaultId,
    pathPrefix: pathPrefix ?? null,
    dryRun,
    verbose,
  });
}

interface ProcessOneFileInput {
  rest: ObsidianRestService;
  filename: string;
  compiledPattern: ReturnType<typeof buildPattern>;
  replacement: string;
  skipCodeBlocks: boolean;
  skipHtmlComments: boolean;
  dryRun: boolean;
  verbose: boolean;
}

async function processOneFile(input: ProcessOneFileInput): Promise<PerFileResult> {
  const {
    rest,
    filename,
    compiledPattern,
    skipCodeBlocks,
    skipHtmlComments,
    dryRun,
    verbose,
  } = input;

  // Fetch. Per Principle IV, errors propagate — but FR-021a says
  // mid-sweep failures are caught and recorded in `failures` rather
  // than aborting. We catch and convert here so the sweep continues.
  let content: string;
  try {
    content = await rest.getFileContents(filename);
  } catch (err) {
    return {
      filename,
      replacements: 0,
      matchesInSkippedRegions: 0,
      outcome: 'failed',
      error: err instanceof Error ? err.message : String(err),
      inputSizeBytes: 0,
      outputSizeBytes: 0,
    };
  }

  const inputSizeBytes = Buffer.byteLength(content, 'utf8');
  if (inputSizeBytes > FILE_SIZE_CAP_BYTES) {
    return {
      filename,
      replacements: 0,
      matchesInSkippedRegions: 0,
      outcome: 'skipped',
      skipReason: 'size_exceeded',
      inputSizeBytes,
      outputSizeBytes: 0,
    };
  }

  // Skip-region detection per FR-007 / FR-008 / FR-009 — independent
  // detectors over the original content, then union (FR-009a — region
  // detection is independent of the user's search regex). The
  // detector returns [] when neither flag is set, so the call is
  // cheap on the no-skip path.
  const skipRegions: SkipRegion[] = detectAllSkipRegions(content, {
    skipCodeBlocks,
    skipHtmlComments,
  });
  const r = applyReplacement(content, compiledPattern, skipRegions);

  // FR-014 byte-identical no-op: if nothing changed, skip the write.
  if (r.output === content) {
    return {
      filename,
      replacements: 0,
      matchesInSkippedRegions: r.matchesInSkippedRegions,
      previews: undefined,
      outcome: 'no-op',
      inputSizeBytes,
      outputSizeBytes: inputSizeBytes,
    };
  }

  const outputSizeBytes = Buffer.byteLength(r.output, 'utf8');
  if (outputSizeBytes > FILE_SIZE_CAP_BYTES) {
    return {
      filename,
      replacements: 0,
      matchesInSkippedRegions: r.matchesInSkippedRegions,
      outcome: 'skipped',
      skipReason: 'output_size_exceeded',
      inputSizeBytes,
      outputSizeBytes,
    };
  }

  // Build previews for dry-run, or for verbose committed runs.
  // Skip the previews build entirely when neither is in effect to
  // keep memory bounded for big sweeps.
  const previews =
    dryRun || verbose ? buildPreviews(r.matches, content) : undefined;

  if (!dryRun) {
    try {
      await rest.putContent(filename, r.output);
    } catch (err) {
      return {
        filename,
        replacements: r.replacementCount,
        matchesInSkippedRegions: r.matchesInSkippedRegions,
        previews,
        outcome: 'failed',
        error: err instanceof Error ? err.message : String(err),
        inputSizeBytes,
        outputSizeBytes,
      };
    }
  }

  return {
    filename,
    replacements: r.replacementCount,
    matchesInSkippedRegions: r.matchesInSkippedRegions,
    previews,
    outcome: 'modified',
    inputSizeBytes,
    outputSizeBytes,
  };
}
