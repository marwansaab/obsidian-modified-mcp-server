/**
 * Typed-error layer over `safeCall` in obsidian-rest.ts.
 *
 * Lets callers (specifically the new delete_file handler) discriminate
 * between transport timeouts, 404s, and other upstream failures without
 * fragile message-string matching. Every subclass extends `Error` and
 * preserves the existing `Obsidian API Error <code>: <message>` text on
 * `.message` so unrelated callers see no behavioural change.
 *
 * See specs/005-fix-directory-delete/data-model.md for the authoritative
 * shape definitions.
 */

export class ObsidianTimeoutError extends Error {
  readonly kind = 'timeout' as const;

  constructor(
    public readonly timeoutMs: number,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ObsidianTimeoutError';
  }
}

export class ObsidianNotFoundError extends Error {
  readonly kind = 'not-found' as const;
  readonly status = 404 as const;

  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ObsidianNotFoundError';
  }
}

export class ObsidianApiError extends Error {
  readonly kind = 'api' as const;

  constructor(
    public readonly status: number,
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = 'ObsidianApiError';
  }
}

export const isObsidianTimeoutError = (e: unknown): e is ObsidianTimeoutError =>
  e instanceof ObsidianTimeoutError;

export const isObsidianNotFoundError = (e: unknown): e is ObsidianNotFoundError =>
  e instanceof ObsidianNotFoundError;
