import process from 'node:process';

import { normalizeModuleId, toPublicModuleId } from '../utils/module-id.js';

export interface ModuleNode {
  id: string;
  path: string;
  imports: Set<string>;
  importedBy: Set<string>;
  transformResult?: unknown;
  hash?: string;
  lastUpdated?: number;
  lastUpdate?: number;
  acceptedHMR?: boolean;
  selfAccepting?: boolean;
  invalidated?: boolean;
  cache?: unknown;
  hmrBoundaries?: unknown;
}

export interface ModuleGraphSnapshot {
  root: string;
  modules: Array<{
    id: string;
    publicId: string;
    imports: string[];
    importedBy: string[];
    hash?: string;
    lastUpdated?: number;
    acceptedHMR: boolean;
    selfAccepting: boolean;
    invalidated: boolean;
  }>;
}

export interface HotUpdatePlan {
  changed: string;
  affected: string[];
  boundaries: string[];
  reload: boolean;
}

export class ModuleGraph {
  private readonly nodes = new Map<string, ModuleNode>();

  constructor(private readonly root = process.cwd()) {}

  normalize(id: string): string {
    return normalizeModuleId(this.root, id);
  }

  publicId(id: string): string {
    return toPublicModuleId(this.root, id);
  }

  addModule(filePath: string): ModuleNode {
    const key = this.normalize(filePath);
    let node = this.nodes.get(key);
    if (node) return node;
    node = {
      id: key,
      path: key,
      imports: new Set(),
      importedBy: new Set(),
      acceptedHMR: false,
      selfAccepting: false,
      invalidated: false
    };
    this.nodes.set(key, node);
    return node;
  }

  linkModule(importer: string, imported: string): void {
    const a = this.addModule(importer);
    const b = this.addModule(imported);
    a.imports.add(b.id);
    b.importedBy.add(a.id);
  }

  unlinkModule(importer: string, imported: string): void {
    const importerKey = this.normalize(importer);
    const importedKey = this.normalize(imported);
    const importerNode = this.nodes.get(importerKey);
    const importedNode = this.nodes.get(importedKey);
    importerNode?.imports.delete(importedKey);
    importedNode?.importedBy.delete(importerKey);
  }

  setDependencies(filePath: string, dependencies: string[]): void {
    const node = this.addModule(filePath);
    const next = new Set(dependencies.map(dependency => this.normalize(dependency)));

    for (const existing of Array.from(node.imports)) {
      if (!next.has(existing)) {
        this.unlinkModule(node.id, existing);
      }
    }

    for (const dependency of next) {
      this.linkModule(node.id, dependency);
    }
  }

  updateModule(filePath: string, patch: Partial<Omit<ModuleNode, 'id' | 'path' | 'imports' | 'importedBy'>>): ModuleNode {
    const node = this.addModule(filePath);
    Object.assign(node, patch);
    if (patch.lastUpdated !== undefined) {
      node.lastUpdate = patch.lastUpdated;
    }
    if (patch.lastUpdate !== undefined) {
      node.lastUpdated = patch.lastUpdate;
    }
    return node;
  }

  invalidate(filePath: string): string[] {
    const key = this.normalize(filePath);
    const node = this.nodes.get(key);
    if (!node) return [];

    const now = Date.now();
    const stack = [node.id];
    const visited = new Set<string>();

    while (stack.length > 0) {
      const id = stack.pop();
      if (!id || visited.has(id)) continue;
      visited.add(id);

      const current = this.nodes.get(id);
      if (!current) continue;
      current.invalidated = true;
      current.lastUpdated = now;
      current.lastUpdate = now;
      current.hash = undefined;
      current.cache = undefined;

      for (const dependent of current.importedBy) {
        stack.push(dependent);
      }
    }

    return Array.from(visited);
  }

  markValid(filePath: string): void {
    const node = this.nodes.get(this.normalize(filePath));
    if (node) {
      node.invalidated = false;
    }
  }

  getDependents(filePath: string): string[] {
    return Array.from(this.nodes.get(this.normalize(filePath))?.importedBy.values() ?? []);
  }

  getDependencies(filePath: string): string[] {
    return Array.from(this.nodes.get(this.normalize(filePath))?.imports.values() ?? []);
  }

  has(filePath: string): boolean {
    return this.nodes.has(this.normalize(filePath));
  }

  get(filePath: string): ModuleNode | undefined {
    return this.nodes.get(this.normalize(filePath));
  }

  getById(moduleId: string): ModuleNode | undefined {
    return this.get(moduleId);
  }

  entries(): ModuleNode[] {
    return Array.from(this.nodes.values());
  }

  resolveHotUpdate(filePath: string): HotUpdatePlan {
    const changed = this.normalize(filePath);
    const affected = this.invalidate(changed);
    const boundaries: string[] = [];
    const seen = new Set<string>();
    const stack = [changed];
    let reload = false;

    while (stack.length > 0) {
      const id = stack.pop();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const node = this.nodes.get(id);
      if (!node) {
        reload = true;
        continue;
      }

      if (node.selfAccepting || node.acceptedHMR) {
        boundaries.push(node.id);
        continue;
      }

      if (node.importedBy.size === 0) {
        reload = true;
      }

      for (const importer of node.importedBy) {
        stack.push(importer);
      }
    }

    return {
      changed,
      affected,
      boundaries,
      reload: reload || boundaries.length === 0
    };
  }

  detectCycles(): string[][] {
    const cycles: string[][] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const stack: string[] = [];

    const visit = (node: ModuleNode) => {
      if (visiting.has(node.id)) {
        const cycleStart = stack.indexOf(node.id);
        if (cycleStart >= 0) {
          cycles.push([...stack.slice(cycleStart), node.id]);
        }
        return;
      }

      if (visited.has(node.id)) return;

      visiting.add(node.id);
      stack.push(node.id);
      for (const dependency of node.imports) {
        const next = this.nodes.get(dependency);
        if (next) visit(next);
      }
      stack.pop();
      visiting.delete(node.id);
      visited.add(node.id);
    };

    for (const node of this.nodes.values()) {
      visit(node);
    }

    return cycles;
  }

  cleanupStale(olderThanMs: number): number {
    const cutoff = Date.now() - olderThanMs;
    let removed = 0;
    for (const node of Array.from(this.nodes.values())) {
      if ((node.lastUpdated ?? 0) >= cutoff || node.importedBy.size > 0) {
        continue;
      }

      for (const dependency of node.imports) {
        this.nodes.get(dependency)?.importedBy.delete(node.id);
      }
      this.nodes.delete(node.id);
      removed += 1;
    }
    return removed;
  }

  snapshot(): ModuleGraphSnapshot {
    return {
      root: this.normalize(this.root),
      modules: this.entries().map(node => ({
        id: node.id,
        publicId: this.publicId(node.id),
        imports: Array.from(node.imports),
        importedBy: Array.from(node.importedBy),
        hash: node.hash,
        lastUpdated: node.lastUpdated,
        acceptedHMR: Boolean(node.acceptedHMR),
        selfAccepting: Boolean(node.selfAccepting),
        invalidated: Boolean(node.invalidated)
      }))
    };
  }

  serialize(): string {
    return JSON.stringify(this.snapshot());
  }

  clear(): void {
    this.nodes.clear();
  }
}

export const createGraph = (root?: string) => new ModuleGraph(root);
