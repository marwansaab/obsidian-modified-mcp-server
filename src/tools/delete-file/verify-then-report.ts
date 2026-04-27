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
  isObsidianTimeoutError,
} from '../../services/obsidian-rest-errors.js';

export class OutcomeUndeterminedError extends Error {
  constructor(public readonly targetPath: string, public readonly cause?: unknown) {
    super(`outcome undetermined for ${targetPath}`);
    this.name = 'OutcomeUndeterminedError';
  }
}

export type TimeoutVerificationOutcome =
  | { outcome: 'success' }
  | { outcome: 'failure'; cause: ObsidianTimeoutError };

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
