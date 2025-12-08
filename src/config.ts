/**
 * Configuration loader for obsidian-mcp-server
 * Reads from environment variables with sensible defaults
 */

import type { Config } from './types.js';

/**
 * Load configuration from environment variables
 * @throws Error if required OBSIDIAN_API_KEY is missing
 */
export function loadConfig(): Config {
  const apiKey = process.env.OBSIDIAN_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OBSIDIAN_API_KEY environment variable is required. ' +
      'Get it from the Obsidian Local REST API plugin settings.'
    );
  }

  const protocol = (process.env.OBSIDIAN_PROTOCOL?.toLowerCase() === 'http' ? 'http' : 'https') as 'http' | 'https';

  return {
    obsidianApiKey: apiKey,
    obsidianHost: process.env.OBSIDIAN_HOST ?? '127.0.0.1',
    obsidianPort: parseInt(process.env.OBSIDIAN_PORT ?? '27124', 10),
    obsidianProtocol: protocol,
    vaultPath: process.env.OBSIDIAN_VAULT_PATH,
    smartConnectionsPort: process.env.SMART_CONNECTIONS_PORT
      ? parseInt(process.env.SMART_CONNECTIONS_PORT, 10)
      : undefined,
    graphCacheTtl: parseInt(process.env.GRAPH_CACHE_TTL ?? '300', 10),
    verifySsl: process.env.OBSIDIAN_VERIFY_SSL === 'true',
  };
}

/** Singleton config instance */
let configInstance: Config | null = null;

/**
 * Get the configuration singleton
 * Lazily loads on first access
 */
export function getConfig(): Config {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Reset config (useful for testing)
 */
export function resetConfig(): void {
  configInstance = null;
}
