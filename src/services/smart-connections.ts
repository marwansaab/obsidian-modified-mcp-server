/**
 * Smart Connections API client for semantic search
 * Requires the Smart Connections plugin and Research MCP Bridge plugin in Obsidian
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import { Agent } from 'node:https';

import type { VaultConfig, SemanticResult } from '../types.js';

export interface SemanticSearchOptions {
  limit?: number;
  threshold?: number;
  folders?: string[];
  excludeFolders?: string[];
}

export interface SmartConnectionsStatus {
  available: boolean;
  message: string;
}

export class SmartConnectionsService {
  private client: AxiosInstance;
  private enabled: boolean;
  private vaultId: string;

  constructor(vault: VaultConfig) {
    this.vaultId = vault.id;
    this.enabled = !!vault.smartConnectionsPort;

    // Smart Connections uses a custom endpoint registered by the Research MCP Bridge plugin
    // It's accessed via the same Obsidian REST API base URL
    const baseURL = `${vault.protocol}://${vault.host}:${vault.port}`;

    this.client = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${vault.apiKey}`,
        'Content-Type': 'application/json',
      },
      httpsAgent: new Agent({ rejectUnauthorized: vault.verifySsl ?? true }),
      timeout: 15000,
    });
  }

  /**
   * Check if Smart Connections is available
   */
  async isAvailable(): Promise<SmartConnectionsStatus> {
    if (!this.enabled) {
      return { available: false, message: 'Smart Connections not configured' };
    }

    try {
      const response = await this.client.post('/search/smart', {
        query: 'test',
        filter: { limit: 1 },
      }, { timeout: 3000 });

      if (response.status === 200) {
        return { available: true, message: 'Smart Connections available' };
      }
      return { available: false, message: `Unexpected status: ${response.status}` };
    } catch (error) {
      if (error instanceof AxiosError) {
        if (error.response?.status === 503) {
          return { available: false, message: 'Smart Connections plugin not ready' };
        }
        if (error.response?.status === 404) {
          return { available: false, message: 'Research MCP Bridge plugin not installed' };
        }
        if (error.code === 'ECONNABORTED') {
          return { available: false, message: 'Connection timeout' };
        }
      }
      return { available: false, message: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Perform semantic search using Smart Connections
   */
  async search(query: string, options: SemanticSearchOptions = {}): Promise<SemanticResult[]> {
    if (!this.enabled) {
      throw new Error(`Smart Connections not configured for vault "${this.vaultId}". Set smartConnectionsPort.`);
    }

    const filter: Record<string, unknown> = {
      limit: options.limit ?? 10,
    };

    if (options.folders?.length) {
      filter.folders = options.folders;
    }
    if (options.excludeFolders?.length) {
      filter.excludeFolders = options.excludeFolders;
    }

    try {
      const response = await this.client.post<{ results: SemanticResult[] }>('/search/smart', {
        query,
        filter,
        threshold: options.threshold ?? 0.7,
      });

      return response.data.results ?? [];
    } catch (error) {
      if (error instanceof AxiosError) {
        if (error.response?.status === 503) {
          throw new Error('Smart Connections plugin not available in Obsidian');
        }
        if (error.response?.status === 404) {
          throw new Error('Research MCP Bridge plugin not installed');
        }
        throw new Error(`Smart Connections error: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Find notes similar to a given note
   */
  async findSimilar(filepath: string, options: SemanticSearchOptions = {}): Promise<SemanticResult[]> {
    if (!this.enabled) {
      throw new Error(`Smart Connections not configured for vault "${this.vaultId}". Set smartConnectionsPort.`);
    }

    try {
      const response = await this.client.post<{ results: SemanticResult[] }>('/search/similar', {
        path: filepath,
        limit: options.limit ?? 10,
        threshold: options.threshold ?? 0.5,
      });

      return response.data.results ?? [];
    } catch (error) {
      if (error instanceof AxiosError) {
        if (error.response?.status === 404) {
          // Fallback: read the note content and do a semantic search
          throw new Error('Similar notes endpoint not available. Use semantic_search with note content instead.');
        }
        throw new Error(`Smart Connections error: ${error.message}`);
      }
      throw error;
    }
  }
}
