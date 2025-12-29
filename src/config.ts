/**
 * Configuration loader for obsidian-mcp-server
 * Reads from environment variables with sensible defaults
 */

import { readFileSync } from 'node:fs';

import type { Config, VaultConfig } from './types.js';

const DEFAULT_VAULT_ID = 'default';

function normalizeVaultConfig(
  partial: Partial<VaultConfig>,
  fallbackId: string,
  globalVerifySsl: boolean
): VaultConfig {
  const id = partial.id ?? fallbackId;
  const apiKey = partial.apiKey;

  if (!apiKey) {
    throw new Error(`Vault "${id}" is missing apiKey`);
  }

  return {
    id,
    apiKey,
    host: partial.host ?? '127.0.0.1',
    port: partial.port ?? 27124,
    protocol: partial.protocol ?? 'https',
    vaultPath: partial.vaultPath,
    smartConnectionsPort: partial.smartConnectionsPort,
    verifySsl: partial.verifySsl ?? globalVerifySsl,
  };
}

function loadVaultsFromJson(source: string, globalVerifySsl: boolean): Record<string, VaultConfig> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`Failed to parse OBSIDIAN_VAULTS_JSON: ${(error as Error).message}`);
  }

  const entries = Array.isArray(parsed) ? parsed : Object.values(parsed as Record<string, unknown>);
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('OBSIDIAN_VAULTS_JSON must describe at least one vault');
  }

  const vaults: Record<string, VaultConfig> = {};

  entries.forEach((entry, index) => {
    const normalized = normalizeVaultConfig(entry as Partial<VaultConfig>, `vault-${index}`, globalVerifySsl);
    vaults[normalized.id] = normalized;
  });

  return vaults;
}

function loadVaults(globalVerifySsl: boolean): Record<string, VaultConfig> {
  const filePath = process.env.OBSIDIAN_VAULTS_FILE;
  if (filePath) {
    const contents = readFileSync(filePath, 'utf-8');
    return loadVaultsFromJson(contents, globalVerifySsl);
  }

  const inlineJson = process.env.OBSIDIAN_VAULTS_JSON;
  if (inlineJson) {
    return loadVaultsFromJson(inlineJson, globalVerifySsl);
  }

  const apiKey = process.env.OBSIDIAN_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OBSIDIAN_API_KEY environment variable is required when OBSIDIAN_VAULTS_JSON/file are not provided.'
    );
  }

  const protocol =
    process.env.OBSIDIAN_PROTOCOL?.toLowerCase() === 'http' ? ('http' as const) : ('https' as const);

  const vault: VaultConfig = {
    id: DEFAULT_VAULT_ID,
    apiKey,
    host: process.env.OBSIDIAN_HOST ?? '127.0.0.1',
    port: parseInt(process.env.OBSIDIAN_PORT ?? '27124', 10),
    protocol,
    vaultPath: process.env.OBSIDIAN_VAULT_PATH,
    smartConnectionsPort: process.env.SMART_CONNECTIONS_PORT
      ? parseInt(process.env.SMART_CONNECTIONS_PORT, 10)
      : undefined,
    verifySsl: process.env.OBSIDIAN_VERIFY_SSL === 'true' ? true : globalVerifySsl,
  };

  return { [vault.id]: vault };
}

function resolveDefaultVault(vaults: Record<string, VaultConfig>): string {
  if (Object.keys(vaults).length === 0) {
    throw new Error('No vaults configured');
  }

  const requestedDefault = process.env.OBSIDIAN_DEFAULT_VAULT;
  if (requestedDefault) {
    if (!vaults[requestedDefault]) {
      throw new Error(`OBSIDIAN_DEFAULT_VAULT "${requestedDefault}" not found in configured vaults`);
    }
    return requestedDefault;
  }

  if (vaults[DEFAULT_VAULT_ID]) {
    return DEFAULT_VAULT_ID;
  }

  return Object.keys(vaults)[0];
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): Config {
  const graphCacheTtl = parseInt(process.env.GRAPH_CACHE_TTL ?? '300', 10);
  const globalVerifySsl = process.env.OBSIDIAN_VERIFY_SSL === 'true';

  const vaults = loadVaults(globalVerifySsl);
  const defaultVaultId = resolveDefaultVault(vaults);

  return {
    defaultVaultId,
    vaults,
    graphCacheTtl,
    verifySsl: globalVerifySsl,
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
