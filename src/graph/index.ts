import path from 'node:path';

export interface ModuleNode {
  id: string;
  path: string;
  imports: Set<string>;
  importedBy: Set<string>;
  hash?: string;
  lastUpdate?: number;
  cache?: unknown;
  transformResult?: unknown;
  hmrBoundaries?: unknown;
}

export class ModuleGraph {
  private readonly nodes = new Map<string, ModuleNode>();
  private readonly aliases = new Map<string, string>();

  private normalize(p: string) {
    return path.resolve(p);
  }

  addModule(filePath: string): ModuleNode {
    const key = this.normalize(filePath);
    let node = this.nodes.get(key);
    if (node) return node;
    node = { id: path.relative(process.cwd(), key) || path.basename(key), path: key, imports: new Set(), importedBy: new Set() };
    this.nodes.set(key, node);
    this.aliases.set(node.id.replace(/\\/g, '/'), key);
    return node;
  }

  linkModule(importer: string, imported: string): void {
    const a = this.addModule(importer);
    const b = this.addModule(imported);
    if (!a.imports.has(b.path)) a.imports.add(b.path);
    if (!b.importedBy.has(a.path)) b.importedBy.add(a.path);
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
        this.unlinkModule(node.path, existing);
      }
    }

    for (const dependency of next) {
      this.linkModule(node.path, dependency);
    }
  }

  updateModule(filePath: string, patch: Partial<Omit<ModuleNode, 'id' | 'path' | 'imports' | 'importedBy'>>): ModuleNode {
    const node = this.addModule(filePath);
    Object.assign(node, patch);
    return node;
  }

  invalidate(filePath: string): string[] {
    const key = this.normalize(filePath);
    const node = this.nodes.get(key);
    if (!node) return [];
    node.lastUpdate = Date.now();
    node.hash = undefined;
    node.cache = undefined;
    // propagate to dependents
    const stack = [node.path];
    const visited = new Set<string>();
    while (stack.length > 0) {
      const p = stack.pop()!;
      if (visited.has(p)) continue;
      visited.add(p);
      const n = this.nodes.get(p);
      if (!n) continue;
      for (const dependent of n.importedBy) {
        const dn = this.nodes.get(dependent);
        if (dn) {
          dn.cache = undefined;
          dn.lastUpdate = Date.now();
        }
        stack.push(dependent);
      }
    }

    return Array.from(visited);
  }

  getDependents(filePath: string): string[] {
    const key = this.normalize(filePath);
    const node = this.nodes.get(key);
    if (!node) return [];
    return Array.from(node.importedBy.values());
  }

  getDependencies(filePath: string): string[] {
    const key = this.normalize(filePath);
    const node = this.nodes.get(key);
    if (!node) return [];
    return Array.from(node.imports.values());
  }

  has(filePath: string): boolean {
    return this.nodes.has(this.normalize(filePath));
  }

  get(filePath: string): ModuleNode | undefined {
    return this.nodes.get(this.normalize(filePath));
  }

  getById(moduleId: string): ModuleNode | undefined {
    const key = this.aliases.get(moduleId.replace(/\\/g, '/'));
    return key ? this.nodes.get(key) : undefined;
  }

  entries(): ModuleNode[] {
    return Array.from(this.nodes.values());
  }

  detectCycles(): string[][] {
    const cycles: string[][] = [];
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const stack: string[] = [];

    const visit = (node: ModuleNode) => {
      if (visiting.has(node.path)) {
        const cycleStart = stack.indexOf(node.path);
        if (cycleStart >= 0) {
          cycles.push([...stack.slice(cycleStart), node.path]);
        }
        return;
      }

      if (visited.has(node.path)) {
        return;
      }

      visiting.add(node.path);
      stack.push(node.path);
      for (const dependency of node.imports) {
        const next = this.nodes.get(dependency);
        if (next) {
          visit(next);
        }
      }
      stack.pop();
      visiting.delete(node.path);
      visited.add(node.path);
    };

    for (const node of this.nodes.values()) {
      visit(node);
    }

    return cycles;
  }

  clear(): void {
    this.nodes.clear();
    this.aliases.clear();
  }
}

export const createGraph = () => new ModuleGraph();
