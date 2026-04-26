/**
 * Obsidian Local REST API client
 * Provides methods for all core vault operations
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import https from 'node:https';

import type { SearchResult, VaultConfig } from '../types.js';

export class ObsidianRestService {
  private client: AxiosInstance;
  private vault: VaultConfig;

  constructor(vault: VaultConfig) {
    this.vault = vault;

    const httpsAgent = new https.Agent({
      rejectUnauthorized: vault.verifySsl ?? true,
    });

    this.client = axios.create({
      baseURL: `${vault.protocol}://${vault.host}:${vault.port}`,
      headers: {
        Authorization: `Bearer ${vault.apiKey}`,
      },
      timeout: 10000,
      httpsAgent,
    });
  }

  /**
   * Wrap API calls with consistent error handling
   */
  private async safeCall<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof AxiosError) {
        const data = error.response?.data as { errorCode?: number; message?: string } | undefined;
        const code = data?.errorCode ?? error.response?.status ?? -1;
        const message = data?.message ?? error.message ?? 'Unknown error';
        throw new Error(`Obsidian API Error ${code}: ${message}`);
      }
      throw error;
    }
  }

  /**
   * List all files and directories in the vault root
   */
  async listFilesInVault(): Promise<string[]> {
    return this.safeCall(async () => {
      const response = await this.client.get<{ files: string[] }>('/vault/');
      return response.data.files;
    });
  }

  /**
   * List files in a specific directory
   * @param dirpath - Path relative to vault root
   */
  async listFilesInDir(dirpath: string): Promise<string[]> {
    return this.safeCall(async () => {
      const response = await this.client.get<{ files: string[] }>(`/vault/${dirpath}/`);
      return response.data.files;
    });
  }

  /**
   * Get the contents of a file
   * @param filepath - Path relative to vault root
   */
  async getFileContents(filepath: string): Promise<string> {
    return this.safeCall(async () => {
      const response = await this.client.get<string>(`/vault/${filepath}`, {
        headers: { Accept: 'text/markdown' },
        responseType: 'text',
      });
      return response.data;
    });
  }

  /**
   * Get contents of multiple files concatenated with headers
   * @param filepaths - Array of file paths
   */
  async getBatchFileContents(filepaths: string[]): Promise<string> {
    const results: string[] = [];
    for (const filepath of filepaths) {
      try {
        const content = await this.getFileContents(filepath);
        results.push(`# ${filepath}\n\n${content}\n\n---\n\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push(`# ${filepath}\n\nError reading file: ${message}\n\n---\n\n`);
      }
    }
    return results.join('');
  }

  /**
   * Simple keyword search across the vault
   * @param query - Search query
   * @param contextLength - Characters of context around matches
   */
  async search(query: string, contextLength = 100): Promise<SearchResult[]> {
    return this.safeCall(async () => {
      const response = await this.client.post<SearchResult[]>('/search/simple/', null, {
        params: { query, contextLength },
      });
      return response.data;
    });
  }

  /**
   * Append content to a file (creates if doesn't exist)
   * @param filepath - Path relative to vault root
   * @param content - Markdown content to append
   */
  async appendContent(filepath: string, content: string): Promise<void> {
    return this.safeCall(async () => {
      await this.client.post(`/vault/${filepath}`, content, {
        headers: { 'Content-Type': 'text/markdown' },
      });
    });
  }

  /**
   * Put (overwrite) content to a file
   * @param filepath - Path relative to vault root
   * @param content - Markdown content
   */
  async putContent(filepath: string, content: string): Promise<void> {
    return this.safeCall(async () => {
      await this.client.put(`/vault/${filepath}`, content, {
        headers: { 'Content-Type': 'text/markdown' },
      });
    });
  }

  /**
   * Get the body content under a heading path within a note.
   * The structural validator runs in the wrapper handler before this
   * method is called, so by the time we get here we are guaranteed
   * `headingPath` has ≥ 2 non-empty `::`-separated segments.
   * @param filepath - Path relative to vault root
   * @param headingPath - H1::H2[::H3...] form, validated upstream by the wrapper
   */
  async getHeadingContents(filepath: string, headingPath: string): Promise<string> {
    return this.safeCall(async () => {
      const encodedPath = filepath.split('/').map(encodeURIComponent).join('/');
      const segments = headingPath.split('::').map(encodeURIComponent).join('/');
      // We send `Accept: text/markdown` so the upstream returns the heading
      // body as raw markdown. We deliberately leave `responseType` at axios's
      // default ('json') so that error responses (which the upstream emits as
      // JSON regardless of the request's Accept header) are decoded into the
      // typed `{ errorCode, message }` shape that `safeCall` expects. axios's
      // `transitional.silentJSONParsing` (default `true` in axios 1.x) makes
      // successful markdown bodies fall back to the raw string when
      // `JSON.parse` throws, so the happy path still returns plain markdown.
      const response = await this.client.get<string>(
        `/vault/${encodedPath}/heading/${segments}`,
        {
          headers: { Accept: 'text/markdown' },
        }
      );
      return response.data;
    });
  }

  /**
   * Get a single frontmatter field's value from a note.
   * Returns the JSON-decoded value (axios's default `responseType: 'json'`
   * decodes the upstream response automatically), preserving the original
   * frontmatter type: string, number, boolean, array, object, or null.
   * @param filepath - Path relative to vault root
   * @param field - The frontmatter field name
   */
  async getFrontmatterField(filepath: string, field: string): Promise<unknown> {
    return this.safeCall(async () => {
      const encodedPath = filepath.split('/').map(encodeURIComponent).join('/');
      const response = await this.client.get<unknown>(
        `/vault/${encodedPath}/frontmatter/${encodeURIComponent(field)}`
      );
      return response.data;
    });
  }

  /**
   * Patch content relative to a heading or block
   * @param filepath - Path relative to vault root
   * @param operation - 'append' | 'prepend' | 'replace'
   * @param targetType - 'heading' | 'block' | 'frontmatter'
   * @param target - The heading text or block ID
   * @param content - Content to insert
   */
  async patchContent(
    filepath: string,
    operation: string,
    targetType: string,
    target: string,
    content: string
  ): Promise<void> {
    return this.safeCall(async () => {
      await this.client.patch(`/vault/${filepath}`, content, {
        headers: {
          'Content-Type': 'text/markdown',
          Operation: operation,
          'Target-Type': targetType,
          Target: encodeURIComponent(target),
        },
      });
    });
  }

  /**
   * Delete a file or directory
   * @param filepath - Path relative to vault root
   */
  async deleteFile(filepath: string): Promise<void> {
    return this.safeCall(async () => {
      await this.client.delete(`/vault/${filepath}`);
    });
  }

  /**
   * Get the currently active file in Obsidian
   */
  async getActiveFile(): Promise<string> {
    return this.safeCall(async () => {
      const response = await this.client.get<string>('/active/', {
        headers: { Accept: 'text/markdown' },
        responseType: 'text',
      });
      return response.data;
    });
  }

  /**
   * Open a file in Obsidian
   * @param filepath - Path relative to vault root
   */
  async openFile(filepath: string): Promise<void> {
    return this.safeCall(async () => {
      await this.client.post('/open/', null, {
        params: { file: filepath },
      });
    });
  }

  /**
   * Search using JsonLogic query
   * @param query - JsonLogic query object
   */
  async searchJson(query: Record<string, unknown>): Promise<unknown[]> {
    return this.safeCall(async () => {
      const response = await this.client.post<unknown[]>('/search/', query, {
        headers: { 'Content-Type': 'application/vnd.olrapi.jsonlogic+json' },
      });
      return response.data;
    });
  }

  /**
   * Get current periodic note
   * @param period - daily, weekly, monthly, quarterly, yearly
   * @param type - content or metadata
   */
  async getPeriodicNote(period: string, type = 'content'): Promise<string> {
    return this.safeCall(async () => {
      const headers: Record<string, string> = {};
      if (type === 'metadata') {
        headers.Accept = 'application/vnd.olrapi.note+json';
      }
      const response = await this.client.get<string>(`/periodic/${period}/`, {
        headers,
        responseType: 'text',
      });
      return response.data;
    });
  }

  /**
   * Get recent periodic notes
   * @param period - daily, weekly, monthly, quarterly, yearly
   * @param limit - Max notes to return
   * @param includeContent - Whether to include content
   */
  async getRecentPeriodicNotes(
    period: string,
    limit = 5,
    includeContent = false
  ): Promise<unknown> {
    return this.safeCall(async () => {
      const response = await this.client.get(`/periodic/${period}/recent`, {
        params: { limit, includeContent },
      });
      return response.data;
    });
  }

  /**
   * Get recently changed files using Dataview query
   * @param limit - Max files to return
   * @param days - Only files modified within this many days
   */
  async getRecentChanges(limit = 10, days = 90): Promise<unknown> {
    const dqlQuery = [
      'TABLE file.mtime',
      `WHERE file.mtime >= date(today) - dur(${days} days)`,
      'SORT file.mtime DESC',
      `LIMIT ${limit}`,
    ].join('\n');

    return this.safeCall(async () => {
      const response = await this.client.post('/search/', dqlQuery, {
        headers: { 'Content-Type': 'application/vnd.olrapi.dataview.dql+txt' },
      });
      return response.data;
    });
  }

  /**
   * List all available Obsidian commands
   */
  async listCommands(): Promise<unknown> {
    return this.safeCall(async () => {
      const response = await this.client.get('/commands/');
      return response.data;
    });
  }

  /**
   * Execute an Obsidian command
   * @param commandId - The command ID to execute
   */
  async executeCommand(commandId: string): Promise<void> {
    return this.safeCall(async () => {
      await this.client.post(`/commands/${encodeURIComponent(commandId)}`);
    });
  }
}
