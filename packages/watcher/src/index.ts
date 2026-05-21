import fs from 'node:fs';
import path from 'node:path';
import type { WatchEvent, WatcherHandle } from '@alexium/types';
import { createEventBus, randomID } from '@alexium/utils';
import { createLogger } from '@alexium/logger';

export interface WatcherOptions {
  readonly paths: string | readonly string[];
  readonly ignored?: string | readonly string[];
  readonly logger?: ReturnType<typeof createLogger>;
  readonly depth?: number;
}

export const createWatcher = (options: WatcherOptions): WatcherHandle => {
  const bus = createEventBus<{ watch: WatchEvent }>();
  const logger = options.logger ?? createLogger({ scope: `watcher:${randomID('watcher')}` });
  const graph = new Map<string, Set<string>>();
  const watchers = new Map<string, fs.FSWatcher>();

  const ignore = (target: string) => {
    if (!options.ignored) {
      return false;
    }

    const patterns = Array.isArray(options.ignored) ? options.ignored : [options.ignored];
    return patterns.some(pattern => typeof pattern === 'string' ? target.includes(pattern) : pattern(target));
  };

  const watchPath = (target: string) => {
    if (ignore(target) || watchers.has(target)) {
      return;
    }

    try {
      const watcher = fs.watch(target, { recursive: true }, (_eventType, filename) => {
        const changed = filename ? path.join(target, filename.toString()) : target;
        logger.debug(`change ${changed}`);
        emit({ kind: 'change', path: changed });
      });

      watchers.set(target, watcher);
      emit({ kind: 'add', path: target });
    } catch (error) {
      emit({ kind: 'error', path: target, detail: error });
    }
  };

  const walk = async (target: string, depth = 0) => {
    if (ignore(target)) {
      return;
    }

    const stats = await fs.promises.stat(target).catch(() => undefined);
    if (!stats) {
      return;
    }

    watchPath(target);

    if (!stats.isDirectory()) {
      return;
    }

    const entries = await fs.promises.readdir(target, { withFileTypes: true }).catch(() => [] as fs.Dirent[]);
    for (const entry of entries) {
      if (entry.isDirectory() && (options.depth === undefined || depth < options.depth)) {
        await walk(path.join(target, entry.name), depth + 1);
      }
    }
  };

  const emit = (event: WatchEvent) => bus.emit('watch', event);

  return {
    bus,
    async start() {
      const paths = Array.isArray(options.paths) ? options.paths : [options.paths];
      for (const target of paths) {
        await walk(target);
      }

      emit({ kind: 'ready' });
    },
    async stop() {
      for (const watcher of watchers.values()) {
        watcher.close();
      }
      watchers.clear();
    },
    track(path, dependencies = []) {
      graph.set(path, new Set(dependencies));
    },
    invalidate(path) {
      const queue = [path];
      const visited = new Set<string>();

      while (queue.length > 0) {
        const current = queue.pop() as string;
        if (visited.has(current)) {
          continue;
        }

        visited.add(current);
        emit({ kind: 'change', path: current, detail: { invalidated: true } });

        for (const [owner, dependencies] of graph.entries()) {
          if (dependencies.has(current)) {
            queue.push(owner);
          }
        }
      }
    }
  };
};

export const createDependencyGraph = () => {
  const graph = new Map<string, Set<string>>();

  return {
    add(node: string, dependencies: readonly string[]) {
      graph.set(node, new Set(dependencies));
    },
    dependents(node: string) {
      const matches: string[] = [];
      for (const [candidate, dependencies] of graph.entries()) {
        if (dependencies.has(node)) {
          matches.push(candidate);
        }
      }
      return matches;
    },
    clear(node: string) {
      graph.delete(node);
    }
  };
};
