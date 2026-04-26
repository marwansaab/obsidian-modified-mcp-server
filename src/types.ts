/**
 * Shared TypeScript types for obsidian-mcp-server
 */

/** Vault file metadata */
export interface VaultFile {
  path: string;
  name: string;
  extension: string;
  isDirectory: boolean;
}

/** Search result from Obsidian REST API */
export interface SearchResult {
  filename: string;
  score?: number;
  matches: SearchMatch[];
}

export interface SearchMatch {
  match: {
    start: number;
    end: number;
  };
  context: string;
}

/** Patch operation types */
export type PatchOperation = 'append' | 'prepend' | 'replace';
export type PatchTargetType = 'heading' | 'block' | 'frontmatter';

/** Graph node representing a note */
export interface GraphNode {
  id: string;
  path: string;
  title: string;
  tags: string[];
  exists: boolean;
}

/** Graph edge representing a link between notes */
export interface GraphEdge {
  source: string;
  target: string;
  type: 'wikilink' | 'embed';
}

/** Vault statistics */
export interface VaultStats {
  totalNotes: number;
  totalLinks: number;
  orphanCount: number;
  tagCount: number;
  clusterCount: number;
}

/** Note connections info */
export interface NoteConnections {
  filepath: string;
  outgoingLinks: string[];
  backlinks: string[];
  tags: string[];
}

/** Envelope wrapping aggregation-tool results with skip metadata (FR-011) */
export type AggregationEnvelope<T> = T & {
  skipped: number;
  skippedPaths: string[];
};

/** Semantic search result */
export interface SemanticResult {
  path: string;
  score: number;
  text?: string;
  breadcrumbs?: string;
}

/** Smart Connections search request */
export interface SmartSearchRequest {
  query: string;
  filter?: {
    folders?: string[];
    excludeFolders?: string[];
    limit?: number;
  };
}

/** Smart Connections search response */
export interface SmartSearchResponse {
  results: SemanticResult[];
}

/** Tool result wrapper */
export interface ToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

/** Individual vault configuration */
export interface VaultConfig {
  id: string;
  apiKey: string;
  host: string;
  port: number;
  protocol: 'http' | 'https';
  vaultPath?: string;
  smartConnectionsPort?: number;
  verifySsl?: boolean;
}

/** Global configuration options */
export interface Config {
  defaultVaultId: string;
  vaults: Record<string, VaultConfig>;
  graphCacheTtl: number;
  verifySsl: boolean;
}
