/**
 * Graph analysis service using graphology
 * Builds and analyzes the vault's link graph for relationship queries
 */

import Graph from 'graphology';
import { bidirectional } from 'graphology-shortest-path';
import pagerank from 'graphology-metrics/centrality/pagerank.js';
import louvain from 'graphology-communities-louvain';
import { promises as fs } from 'node:fs';
import { join, relative, basename, extname } from 'node:path';
import type { Config, GraphNode, GraphEdge, VaultStats, NoteConnections } from '../types.js';

// Regex patterns for parsing markdown
const WIKILINK_REGEX = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]+)?\]\]/g;
const MARKDOWN_LINK_REGEX = /\[([^\]]+)\]\(([^)]+\.md)\)/g;
const TAG_REGEX = /#([a-zA-Z][a-zA-Z0-9_/-]*)/g;
const EMBED_REGEX = /!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

export interface GraphStats {
  totalNotes: number;
  totalLinks: number;
  orphanCount: number;
  tagCount: number;
  clusterCount: number;
}

export interface ClusterInfo {
  id: number;
  notes: string[];
  size: number;
}

export class GraphService {
  private graph: Graph;
  private vaultPath: string;
  private initialized = false;
  private lastBuildTime = 0;
  private cacheTTL: number;
  private noteTags: Map<string, string[]> = new Map();

  constructor(config: Config) {
    this.vaultPath = config.vaultPath || '';
    this.cacheTTL = (config.graphCacheTtl || 300) * 1000; // Convert to ms
    this.graph = new Graph({ type: 'directed', allowSelfLoops: false });
  }

  /**
   * Check if the graph needs rebuilding
   */
  private needsRebuild(): boolean {
    if (!this.initialized) return true;
    return Date.now() - this.lastBuildTime > this.cacheTTL;
  }

  /**
   * Build or rebuild the graph from vault files
   */
  async buildGraph(): Promise<void> {
    if (!this.vaultPath) {
      throw new Error('OBSIDIAN_VAULT_PATH not configured');
    }

    // Clear existing graph
    this.graph.clear();
    this.noteTags.clear();

    // Find all markdown files
    const mdFiles = await this.findMarkdownFiles(this.vaultPath);

    // Add all notes as nodes first
    for (const filePath of mdFiles) {
      const relativePath = relative(this.vaultPath, filePath);
      const name = basename(filePath, '.md');
      this.graph.addNode(relativePath, { name, path: relativePath });
    }

    // Parse each file for links
    for (const filePath of mdFiles) {
      const relativePath = relative(this.vaultPath, filePath);
      const content = await fs.readFile(filePath, 'utf-8');

      // Extract wikilinks
      const wikilinks = this.extractWikilinks(content);
      for (const target of wikilinks) {
        const targetPath = this.resolveLink(target, mdFiles);
        if (targetPath && this.graph.hasNode(targetPath) && relativePath !== targetPath) {
          if (!this.graph.hasEdge(relativePath, targetPath)) {
            this.graph.addEdge(relativePath, targetPath, { type: 'link' });
          }
        }
      }

      // Extract markdown links
      const mdLinks = this.extractMarkdownLinks(content);
      for (const target of mdLinks) {
        const targetPath = this.resolveLink(target, mdFiles);
        if (targetPath && this.graph.hasNode(targetPath) && relativePath !== targetPath) {
          if (!this.graph.hasEdge(relativePath, targetPath)) {
            this.graph.addEdge(relativePath, targetPath, { type: 'link' });
          }
        }
      }

      // Extract tags
      const tags = this.extractTags(content);
      if (tags.length > 0) {
        this.noteTags.set(relativePath, tags);
      }
    }

    this.initialized = true;
    this.lastBuildTime = Date.now();
  }

  /**
   * Ensure graph is built and up to date
   */
  private async ensureGraph(): Promise<void> {
    if (this.needsRebuild()) {
      await this.buildGraph();
    }
  }

  /**
   * Find all markdown files in the vault
   */
  private async findMarkdownFiles(dir: string): Promise<string[]> {
    const files: string[] = [];

    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      // Skip hidden files/folders and common exclusions
      if (entry.name.startsWith('.') || entry.name === 'node_modules') {
        continue;
      }

      if (entry.isDirectory()) {
        const subFiles = await this.findMarkdownFiles(fullPath);
        files.push(...subFiles);
      } else if (entry.isFile() && extname(entry.name) === '.md') {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Extract wikilinks from content
   */
  private extractWikilinks(content: string): string[] {
    const links: string[] = [];
    let match;
    while ((match = WIKILINK_REGEX.exec(content)) !== null) {
      links.push(match[1].trim());
    }
    WIKILINK_REGEX.lastIndex = 0; // Reset regex
    return links;
  }

  /**
   * Extract markdown links from content
   */
  private extractMarkdownLinks(content: string): string[] {
    const links: string[] = [];
    let match;
    while ((match = MARKDOWN_LINK_REGEX.exec(content)) !== null) {
      links.push(match[2].trim());
    }
    MARKDOWN_LINK_REGEX.lastIndex = 0;
    return links;
  }

  /**
   * Extract tags from content
   */
  private extractTags(content: string): string[] {
    const tags: string[] = [];
    let match;
    while ((match = TAG_REGEX.exec(content)) !== null) {
      tags.push(match[1]);
    }
    TAG_REGEX.lastIndex = 0;
    return [...new Set(tags)]; // Dedupe
  }

  /**
   * Resolve a link target to a file path
   */
  private resolveLink(target: string, allFiles: string[]): string | null {
    // Normalize target
    const normalized = target.replace(/\.md$/, '');

    for (const filePath of allFiles) {
      const relativePath = relative(this.vaultPath, filePath);
      const name = basename(filePath, '.md');

      // Exact match
      if (relativePath === target || relativePath === `${target}.md`) {
        return relativePath;
      }

      // Basename match (Obsidian's default behavior)
      if (name === normalized) {
        return relativePath;
      }
    }

    return null;
  }

  // ============ Public API ============

  /**
   * Get vault statistics
   */
  async getVaultStats(): Promise<VaultStats> {
    await this.ensureGraph();

    const totalNotes = this.graph.order;
    const totalLinks = this.graph.size;

    // Count orphans (nodes with no edges)
    let orphanCount = 0;
    this.graph.forEachNode((node) => {
      if (this.graph.degree(node) === 0) {
        orphanCount++;
      }
    });

    // Count unique tags
    const allTags = new Set<string>();
    this.noteTags.forEach((tags) => tags.forEach((t) => allTags.add(t)));

    // Detect clusters
    const communities = louvain(this.graph);
    const clusterIds = new Set(Object.values(communities));

    return {
      totalNotes,
      totalLinks,
      orphanCount,
      tagCount: allTags.size,
      clusterCount: clusterIds.size,
    };
  }

  /**
   * Find orphan notes (no links in or out)
   */
  async findOrphanNotes(includeBacklinks = true): Promise<string[]> {
    await this.ensureGraph();

    const orphans: string[] = [];
    this.graph.forEachNode((node) => {
      if (includeBacklinks) {
        if (this.graph.degree(node) === 0) {
          orphans.push(node);
        }
      } else {
        if (this.graph.outDegree(node) === 0) {
          orphans.push(node);
        }
      }
    });

    return orphans;
  }

  /**
   * Get connections for a specific note
   */
  async getNoteConnections(filepath: string, depth = 1): Promise<NoteConnections> {
    await this.ensureGraph();

    // Normalize path
    const nodePath = filepath.endsWith('.md') ? filepath : `${filepath}.md`;

    if (!this.graph.hasNode(nodePath)) {
      throw new Error(`Note not found in graph: ${filepath}`);
    }

    const outgoingLinks: string[] = [];
    const backlinks: string[] = [];

    this.graph.forEachOutNeighbor(nodePath, (neighbor) => {
      outgoingLinks.push(neighbor);
    });

    this.graph.forEachInNeighbor(nodePath, (neighbor) => {
      backlinks.push(neighbor);
    });

    const tags = this.noteTags.get(nodePath) || [];

    return {
      filepath: nodePath,
      outgoingLinks,
      backlinks,
      tags,
    };
  }

  /**
   * Find shortest path between two notes
   */
  async findPathBetweenNotes(source: string, target: string, maxDepth = 5): Promise<string[] | null> {
    await this.ensureGraph();

    const sourcePath = source.endsWith('.md') ? source : `${source}.md`;
    const targetPath = target.endsWith('.md') ? target : `${target}.md`;

    if (!this.graph.hasNode(sourcePath)) {
      throw new Error(`Source note not found: ${source}`);
    }
    if (!this.graph.hasNode(targetPath)) {
      throw new Error(`Target note not found: ${target}`);
    }

    // Use bidirectional search for efficiency
    const path = bidirectional(this.graph, sourcePath, targetPath);

    if (path && path.length <= maxDepth + 1) {
      return path;
    }

    return null;
  }

  /**
   * Get most connected notes
   */
  async getMostConnectedNotes(limit = 10, metric: 'links' | 'backlinks' | 'pagerank' = 'backlinks'): Promise<Array<{ path: string; score: number }>> {
    await this.ensureGraph();

    const scores: Array<{ path: string; score: number }> = [];

    if (metric === 'pagerank') {
      const ranks = pagerank(this.graph);
      for (const [node, score] of Object.entries(ranks)) {
        scores.push({ path: node, score });
      }
    } else {
      this.graph.forEachNode((node) => {
        const score = metric === 'backlinks' ? this.graph.inDegree(node) : this.graph.outDegree(node);
        scores.push({ path: node, score });
      });
    }

    return scores.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Detect note clusters using Louvain community detection
   */
  async detectNoteClusters(minClusterSize = 3): Promise<ClusterInfo[]> {
    await this.ensureGraph();

    const communities = louvain(this.graph);

    // Group notes by cluster
    const clusterMap = new Map<number, string[]>();
    for (const [node, clusterId] of Object.entries(communities)) {
      if (!clusterMap.has(clusterId)) {
        clusterMap.set(clusterId, []);
      }
      clusterMap.get(clusterId)!.push(node);
    }

    // Filter and format
    const clusters: ClusterInfo[] = [];
    for (const [id, notes] of clusterMap) {
      if (notes.length >= minClusterSize) {
        clusters.push({ id, notes, size: notes.length });
      }
    }

    return clusters.sort((a, b) => b.size - a.size);
  }

  /**
   * Get vault folder structure
   */
  async getVaultStructure(maxDepth?: number, includeFiles = false): Promise<Record<string, unknown>> {
    if (!this.vaultPath) {
      throw new Error('OBSIDIAN_VAULT_PATH not configured');
    }

    const buildTree = async (dir: string, currentDepth: number): Promise<Record<string, unknown>> => {
      if (maxDepth !== undefined && currentDepth > maxDepth) {
        return {};
      }

      const tree: Record<string, unknown> = {};
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;

        if (entry.isDirectory()) {
          tree[entry.name + '/'] = await buildTree(join(dir, entry.name), currentDepth + 1);
        } else if (includeFiles && extname(entry.name) === '.md') {
          tree[entry.name] = null;
        }
      }

      return tree;
    };

    return buildTree(this.vaultPath, 0);
  }
}
