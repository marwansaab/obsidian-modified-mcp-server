/**
 * Path-separator normalisation helpers for vault-relative path inputs.
 *
 * The wrapper's published input contract is forward-slash-friendly: every
 * tool that takes a `filepath` accepts forward-slash, backslash, or mixed
 * separator forms. Most tools enforce that contract automatically because
 * they round-trip through the upstream Obsidian Local REST API, which
 * canonicalises separators server-side. The graph tools and the Smart
 * Connections passthrough tool do NOT round-trip — they read an in-process
 * graphology index keyed by `path.relative()` (OS-native), or they POST
 * directly to the Smart Connections plugin (forward-slash, like the rest
 * of Obsidian's surface).
 *
 * This module provides the two normalisation targets each consumer needs:
 *   - `toOsNativePath` — used by graph-tool handlers before in-process
 *     `graph.hasNode()` lookups.
 *   - `toForwardSlashPath` — used by the `find_similar_notes` dispatcher
 *     case before POSTing to Smart Connections.
 *
 * Both helpers are pure string transforms: idempotent, length-preserving,
 * total over `string`. See specs/006-normalise-graph-paths/research.md R1
 * for the rationale behind the per-tool target choice.
 */

import { isAbsolute, sep } from 'node:path';

const SEPARATOR_REGEX = /[\\/]/g;

export function toOsNativePath(p: string): string {
  return p.replace(SEPARATOR_REGEX, sep);
}

export function toForwardSlashPath(p: string): string {
  return p.replace(SEPARATOR_REGEX, '/');
}

export function isAbsolutePath(p: string): boolean {
  return isAbsolute(p);
}
