/**
 * Recursive directory walk for delete_file.
 *
 * Walks a directory in upstream listing order (FR-014), recursively
 * deletes every contained file and subdirectory, and threads a single
 * `WalkState` instance through every recursive call so the handler can
 * read consolidated counters and a flat trace of deleted paths after the
 * walk returns.
 *
 * Per-item deletes go through `attemptWithVerification` so a transport
 * timeout that masks an actual upstream success does not prematurely
 * abort the walk (FR-008). Spec 007 switches the per-item verification
 * query from a parent-listing probe to a direct-path probe via
 * `pathExists`, eliminating the auto-prune false-undetermined failure
 * mode.
 *
 * The outer-directory delete is the handler's responsibility, not this
 * module's. See specs/005-fix-directory-delete/research.md § R3 for the
 * walk algorithm and specs/007-fix-delete-verify-direct/data-model.md
 * for the verification-query change.
 */

import { attemptWithVerification, pathExists } from './verify-then-report.js';
import { ObsidianRestService } from '../../services/obsidian-rest.js';


export interface WalkState {
  deletedPaths: string[];
  filesRemoved: number;
  subdirectoriesRemoved: number;
}

export class PartialDeleteError extends Error {
  constructor(public readonly failedPath: string, public readonly deletedPaths: string[]) {
    super(`child failed: ${failedPath} — already deleted: [${deletedPaths.join(', ')}]`);
    this.name = 'PartialDeleteError';
  }
}

function joinPath(parent: string, child: string): string {
  if (parent === '') return child;
  return `${parent}/${child}`;
}

export function parentOf(path: string): string {
  const idx = path.lastIndexOf('/');
  if (idx < 0) return '';
  return path.slice(0, idx);
}

export function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  if (idx < 0) return path;
  return path.slice(idx + 1);
}

async function attemptChildDelete(
  rest: ObsidianRestService,
  childPath: string,
  kind: 'file' | 'directory',
  walkState: WalkState
): Promise<'success' | 'failure'> {
  try {
    const result = await attemptWithVerification(
      childPath,
      () => rest.deleteFile(childPath),
      () => pathExists(rest, childPath, kind)
    );
    return result.outcome;
  } catch (err) {
    // OutcomeUndeterminedError must propagate to the handler (it has its
    // own dedicated error category in the contract). Any other non-timeout
    // upstream error from the per-item delete is folded into
    // PartialDeleteError so the caller learns which child failed and what
    // had already been deleted.
    if ((err as Error).name === 'OutcomeUndeterminedError') {
      throw err;
    }
    throw new PartialDeleteError(childPath, [...walkState.deletedPaths]);
  }
}

export async function recursiveDeleteDirectory(
  rest: ObsidianRestService,
  dirpath: string,
  walkState: WalkState
): Promise<void> {
  const children = await rest.listFilesInDir(dirpath);

  for (const child of children) {
    if (child.endsWith('/')) {
      const childDirName = child.replace(/\/$/, '');
      const childDir = joinPath(dirpath, childDirName);

      await recursiveDeleteDirectory(rest, childDir, walkState);

      const outcome = await attemptChildDelete(rest, childDir, 'directory', walkState);
      if (outcome === 'success') {
        walkState.deletedPaths.push(childDir);
        walkState.subdirectoriesRemoved += 1;
      } else {
        throw new PartialDeleteError(childDir, [...walkState.deletedPaths]);
      }
    } else {
      const childFile = joinPath(dirpath, child);

      const outcome = await attemptChildDelete(rest, childFile, 'file', walkState);
      if (outcome === 'success') {
        walkState.deletedPaths.push(childFile);
        walkState.filesRemoved += 1;
      } else {
        throw new PartialDeleteError(childFile, [...walkState.deletedPaths]);
      }
    }
  }
}
