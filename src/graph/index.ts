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

  private normalize(p: string) {
    return path.resolve(p);
  }

  addModule(filePath: string): ModuleNode {
    const key = this.normalize(filePath);
    let node = this.nodes.get(key);
    if (node) return node;
    node = { id: path.relative(process.cwd(), key) || path.basename(key), path: key, imports: new Set(), importedBy: new Set() };
    this.nodes.set(key, node);
    return node;
  }

  linkModule(importer: string, imported: string): void {
    const a = this.addModule(importer);
    const b = this.addModule(imported);
    if (!a.imports.has(b.path)) a.imports.add(b.path);
    if (!b.importedBy.has(a.path)) b.importedBy.add(a.path);
  }

  invalidate(filePath: string): void {
    const key = this.normalize(filePath);
    const node = this.nodes.get(key);
    if (!node) return;
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

  clear(): void {
    this.nodes.clear();
  }
}

export const createGraph = () => new ModuleGraph();
