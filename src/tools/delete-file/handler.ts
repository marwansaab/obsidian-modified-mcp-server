/**
 * delete_file MCP tool handler.
 *
 * Orchestrates the recursive delete + timeout-then-verify behaviour
 * specified in specs/005-fix-directory-delete/contracts/delete_file.md.
 *
 * Responsibilities:
 *   1. Validate input via the zod schema (Constitution Principle III).
 *   2. Normalise trailing slash so `foo/` and `foo` are the same target.
 *   3. Detect file-vs-directory-vs-missing by inspecting the parent listing.
 *   4. Drive the recursive walk for directories (via `recursive-delete.ts`).
 *   5. Issue the final outer delete (or single file delete) under
 *      timeout-then-verify protection.
 *   6. Translate every caught error to the contract's error categories.
 *
 * The handler always throws plain `Error`s on failure; the dispatcher's
 * existing `try/catch` in `src/index.ts` wraps them into the MCP
 * `{content, isError: true}` shape.
 */

import { z } from 'zod';

import {
  basename,
  listingHasName,
  parentOf,
  PartialDeleteError,
  recursiveDeleteDirectory,
  WalkState,
} from './recursive-delete.js';
import { assertValidDeleteFileRequest } from './schema.js';
import {
  attemptWithVerification,
  OutcomeUndeterminedError,
} from './verify-then-report.js';
import {
  ObsidianApiError,
  ObsidianNotFoundError,
} from '../../services/obsidian-rest-errors.js';
import { ObsidianRestService } from '../../services/obsidian-rest.js';


import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export async function handleDeleteFile(
  args: unknown,
  rest: ObsidianRestService
): Promise<CallToolResult> {
  let target = '';

  try {
    const req = assertValidDeleteFileRequest(args);
    target = req.filepath.replace(/\/$/, '');

    const parent = parentOf(target);
    const name = basename(target);

    const parentEntries =
      parent === '' ? await rest.listFilesInVault() : await rest.listFilesInDir(parent);

    let kind: 'directory' | 'file';
    if (parentEntries.includes(`${name}/`)) {
      kind = 'directory';
    } else if (parentEntries.includes(name)) {
      kind = 'file';
    } else {
      throw new ObsidianNotFoundError(`Obsidian API Error 404: not found: ${target}`);
    }

    if (kind === 'directory') {
      const walkState: WalkState = {
        deletedPaths: [],
        filesRemoved: 0,
        subdirectoriesRemoved: 0,
      };

      await recursiveDeleteDirectory(rest, target, walkState);

      const outerResult = await attemptWithVerification(
        target,
        () => rest.deleteFile(target),
        () => listingHasName(rest, parent, name)
      );
      if (outerResult.outcome === 'failure') {
        throw new PartialDeleteError(target, [...walkState.deletedPaths]);
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              deletedPath: target,
              filesRemoved: walkState.filesRemoved,
              subdirectoriesRemoved: walkState.subdirectoriesRemoved,
            }),
          },
        ],
      };
    }

    // file branch
    const fileResult = await attemptWithVerification(
      target,
      () => rest.deleteFile(target),
      () => listingHasName(rest, parent, name)
    );
    if (fileResult.outcome === 'failure') {
      throw new ObsidianApiError(
        -1,
        `Obsidian API Error -1: delete failed for ${target}`,
        fileResult.cause
      );
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ok: true,
            deletedPath: target,
            filesRemoved: 0,
            subdirectoriesRemoved: 0,
          }),
        },
      ],
    };
  } catch (err) {
    if (err instanceof z.ZodError) {
      const issue = err.issues[0];
      const path = issue?.path.join('.') ?? '';
      throw new Error(`Invalid input — ${path}: ${issue?.message ?? 'invalid'}`);
    }
    if (err instanceof ObsidianNotFoundError) {
      throw new Error(`not found: ${target}`);
    }
    if (err instanceof PartialDeleteError) {
      throw new Error(
        `child failed: ${err.failedPath} — already deleted: [${err.deletedPaths.join(', ')}]`
      );
    }
    if (err instanceof OutcomeUndeterminedError) {
      throw new Error(`outcome undetermined for ${target}`);
    }
    throw err;
  }
}
