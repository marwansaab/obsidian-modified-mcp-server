/**
 * Timeout-then-verify utility for the delete_file handler.
 *
 * Wraps any single upstream operation (the outer directory delete or a
 * per-item delete inside the recursive walk). On a transport timeout it
 * issues a single verification listing query to determine the actual
 * post-condition on the vault. On any non-timeout error it rethrows
 * unchanged. If the verification query itself fails, it throws
 * `OutcomeUndeterminedError` — single-shot, no retry (FR-009 / Q3).
 *
 * See specs/005-fix-directory-delete/data-model.md § TimeoutVerificationOutcome
 * and research.md § R4 for the authoritative behavioural definition.
 */

import {
  ObsidianTimeoutError,
  isObsidianNotFoundError,
  isObsidianTimeoutError,
} from '../../services/obsidian-rest-errors.js';
import { ObsidianRestService } from '../../services/obsidian-rest.js';

export class OutcomeUndeterminedError extends Error {
  constructor(public readonly targetPath: string, public readonly cause?: unknown) {
    super(`outcome undetermined for ${targetPath}`);
    this.name = 'OutcomeUndeterminedError';
  }
}

export class DeleteDidNotTakeEffectError extends Error {
  constructor(
    public readonly targetPath: string,
    public readonly filesRemoved: number,
    public readonly subdirectoriesRemoved: number
  ) {
    super(
      `delete did not take effect: ${targetPath} ` +
        `(filesRemoved=${filesRemoved}, subdirectoriesRemoved=${subdirectoriesRemoved})`
    );
    this.name = 'DeleteDidNotTakeEffectError';
  }
}

export type TimeoutVerificationOutcome =
  | { outcome: 'success' }
  | { outcome: 'failure'; cause: ObsidianTimeoutError };

// Direct-path probe for a deleted target: queries the path itself and
// translates the upstream's response into an absent/present signal.
// 404 (ObsidianNotFoundError) → 'absent' (positive evidence of success).
// 2xx success → 'present' (positive evidence the delete did not take effect).
// Any other failure (timeout, connection reset, 5xx) is rethrown so the
// caller (attemptWithVerification) can convert it to OutcomeUndeterminedError
// per spec 005 FR-009 / spec 007 FR-004.
export async function pathExists(
  rest: ObsidianRestService,
  path: string,
  kind: 'file' | 'directory'
): Promise<'absent' | 'present'> {
  try {
    if (kind === 'directory') {
      await rest.listFilesInDir(path);
    } else {
      await rest.getFileContents(path);
    }
    return 'present';
  } catch (err) {
    if (isObsidianNotFoundError(err)) return 'absent';
    throw err;
  }
}

export async function attemptWithVerification<T>(
  targetPath: string,
  operation: () => Promise<T>,
  verify: () => Promise<'absent' | 'present'>
): Promise<TimeoutVerificationOutcome> {
  try {
    await operation();
    return { outcome: 'success' };
  } catch (err) {
    if (isObsidianTimeoutError(err)) {
      let observation: 'absent' | 'present';
      try {
        observation = await verify();
      } catch (verifyErr) {
        throw new OutcomeUndeterminedError(targetPath, verifyErr);
      }
      if (observation === 'absent') return { outcome: 'success' };
      return { outcome: 'failure', cause: err };
    }
    throw err;
  }
}
