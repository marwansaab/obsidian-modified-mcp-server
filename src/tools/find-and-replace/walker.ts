/**
 * find_and_replace tool: vault walker.
 *
 * Enumerates every `.md` file in the targeted vault (filtered by
 * `pathPrefix` when set) using the existing `listFilesInVault` and
 * `listFilesInDir` infrastructure. Returns vault-relative paths with
 * forward slashes and no leading slash (R11).
 *
 * Filter rules:
 *   FR-024  — `.md` extension match is case-insensitive
 *             (`.md`, `.MD`, `.Md`, `.mD` all qualify).
 *   FR-024b — any file under a path segment that begins with `.`
 *             is excluded (protects `.obsidian/`, `.trash/`, etc.).
 *             Recursion does not descend into dot-prefixed directories.
 *   FR-004  — `pathPrefix` is a directory-segment prefix:
 *             a file's vault-relative path matches when it equals
 *             `pathPrefix` exactly OR starts with `pathPrefix` followed
 *             by `/`. Trailing slash is normalized away. Case-sensitive
 *             on all platforms (Windows included).
 *
 * LAYER 3 — Multi-vault dispatch wrapper. Original contribution of this
 * project. Vault-walk strategy (recurse + per-file processing) credited
 * to blacksmithers/vaultforge's grep-sub tool (MIT). The multi-vault
 * routing — that this walker operates on whichever ObsidianRestService
 * instance the caller resolved via getRestService(vaultId) — is the
 * original-contribution layer not present in cyanheads, vaultforge, or
 * MCPVault.
 */

import type { ObsidianRestService } from '../../services/obsidian-rest.js';

const MD_EXTENSION_RE = /\.md$/i;

/** A directory entry returned by the REST API ends with '/'; a file does not. */
function isDirectoryEntry(entry: string): boolean {
  return entry.endsWith('/');
}

/** Strip a single trailing slash if present; idempotent for non-slash inputs. */
function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

/** Normalize an entry to a vault-relative path with no trailing slash. */
function normalizeEntryName(entry: string): string {
  return stripTrailingSlash(entry);
}

/**
 * Returns true if any path segment of the given vault-relative path
 * begins with `.`. Used for FR-024b dot-prefix exclusion.
 */
function hasDotPrefixedSegment(vaultRelativePath: string): boolean {
  const segments = vaultRelativePath.split('/');
  return segments.some((seg) => seg.startsWith('.'));
}

/**
 * Returns true if the given vault-relative path matches the FR-004
 * directory-segment rule against the (already-normalized) prefix.
 * Both inputs must have NO trailing slash.
 */
function matchesPathPrefix(filePath: string, normalizedPrefix: string): boolean {
  if (normalizedPrefix.length === 0) return true;
  if (filePath === normalizedPrefix) return true;
  return filePath.startsWith(normalizedPrefix + '/');
}

/**
 * Recursively enumerate every `.md` file in the vault under the given
 * directory, applying the FR-024b dot-prefix filter at each level.
 *
 * @param rest        per-vault REST client
 * @param dir         vault-relative directory (empty string for root)
 * @returns           sorted vault-relative file paths (forward slashes)
 */
async function walkDir(rest: ObsidianRestService, dir: string): Promise<string[]> {
  // Distinguish root vs subdirectory enumeration paths against the REST API.
  const entries =
    dir === '' ? await rest.listFilesInVault() : await rest.listFilesInDir(dir);

  const results: string[] = [];
  for (const entry of entries) {
    const name = normalizeEntryName(entry);
    if (name.length === 0) continue;
    // FR-024b: skip any segment beginning with '.'
    if (name.startsWith('.')) continue;

    const childPath = dir === '' ? name : `${dir}/${name}`;

    if (isDirectoryEntry(entry)) {
      const subFiles = await walkDir(rest, childPath);
      results.push(...subFiles);
    } else if (MD_EXTENSION_RE.test(name)) {
      // FR-024: case-insensitive .md extension match
      results.push(childPath);
    }
  }
  return results;
}

/**
 * Public walker entry point. Returns an array of vault-relative `.md`
 * file paths, in lexicographic UTF-8 ascending order, after applying
 * the FR-024 / FR-024b / FR-004 filters.
 *
 * Sorting at the end (rather than during walk) keeps the recursion
 * straightforward; FR-020c sort-order requirements at the response
 * layer rely on this canonical ordering.
 */
export async function walkVault(
  rest: ObsidianRestService,
  pathPrefix?: string,
): Promise<string[]> {
  const normalizedPrefix = pathPrefix === undefined ? '' : stripTrailingSlash(pathPrefix);
  const allFiles = await walkDir(rest, '');

  const filtered = allFiles.filter((p) => {
    if (hasDotPrefixedSegment(p)) return false;
    return matchesPathPrefix(p, normalizedPrefix);
  });

  filtered.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return filtered;
}

// Re-exported for test introspection.
export const __testing = {
  hasDotPrefixedSegment,
  matchesPathPrefix,
  stripTrailingSlash,
  isDirectoryEntry,
};
