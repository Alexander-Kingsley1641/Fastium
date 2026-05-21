import { readdir, stat } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';

import { createNativeWatchBuffer, shouldIgnoreNativePath, type NativeWatchEvent } from '../native/watcher/index.js';
import { createTaskQueue } from '../utils/index.js';

export interface FileChange {
  path: string;
  event: 'add' | 'change' | 'unlink';
}

export interface WatcherOptions {
  debounceMs?: number;
  ignored?: Array<string | RegExp>;
  lowLatency?: boolean;
}

const collectDirectories = async (rootDir: string): Promise<string[]> => {
  const directories: string[] = [rootDir];
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directory = path.join(rootDir, entry.name);
    if (shouldIgnoreNativePath(directory)) {
      continue;
    }

    directories.push(...await collectDirectories(directory));
  }

  return directories;
};

export const createWatcher = (rootDir: string, onChange: (changes: FileChange[]) => void | Promise<void>, options: WatcherOptions = {}) => {
  const watchers = new Map<string, FSWatcher>();
  const queue = createTaskQueue();
  const pending = new Map<string, FileChange>();
  const nativeBuffer = createNativeWatchBuffer(2048);
  const debounceMs = options.debounceMs ?? (options.lowLatency === false ? 30 : 8);
  let timer: NodeJS.Timeout | undefined;

  const shouldIgnore = (filePath: string): boolean => {
    if (shouldIgnoreNativePath(filePath)) {
      return true;
    }

    for (const ignored of options.ignored ?? []) {
      if (typeof ignored === 'string' && filePath.includes(ignored)) {
        return true;
      }

      if (ignored instanceof RegExp && ignored.test(filePath)) {
        return true;
      }
    }

    return false;
  };

  const nativeEvent = (event: FileChange['event']): NativeWatchEvent => {
    if (event === 'add') return 1;
    if (event === 'change') return 2;
    return 3;
  };

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      const changes = Array.from(pending.values());
      pending.clear();
      queue.push(async () => {
        await onChange(changes);
      });
    }, debounceMs);
  };

  const addChange = (change: FileChange) => {
    if (shouldIgnore(change.path)) {
      return;
    }

    nativeBuffer.push(change.path, nativeEvent(change.event));
    pending.set(change.path, change);
    flush();
  };

  const start = async () => {
    // Use recursive watch on supported platforms to reduce resource usage
    const useRecursive = process.platform === 'win32' || process.platform === 'darwin';
    if (useRecursive) {
      const watcher = watch(rootDir, { persistent: true, recursive: true }, (event, fileName) => {
        const filePath = fileName ? path.join(rootDir, fileName.toString()) : rootDir;
        if (event === 'change') {
          addChange({ path: filePath, event: 'change' });
          return;
        }

        // 'rename' may indicate add or unlink
        void stat(filePath)
          .then(() => addChange({ path: filePath, event: 'add' }))
          .catch(() => addChange({ path: filePath, event: 'unlink' }));
      });

      watchers.set(rootDir, watcher);
      return;
    }

    const directories = await collectDirectories(rootDir);
    for (const directory of directories) {
      if (watchers.has(directory)) {
        continue;
      }

      const watcher = watch(directory, { persistent: true }, (event, fileName) => {
        const filePath = fileName ? path.join(directory, fileName.toString()) : directory;
        if (event === 'change') {
          addChange({ path: filePath, event: 'change' });
          return;
        }

        void stat(filePath)
          .then(() => addChange({ path: filePath, event: 'add' }))
          .catch(() => addChange({ path: filePath, event: 'unlink' }));
      });

      watchers.set(directory, watcher);
    }
  };

  const close = () => {
    for (const watcher of watchers.values()) {
      watcher.close();
    }

    watchers.clear();
    pending.clear();
    nativeBuffer.clear();
    if (timer) {
      clearTimeout(timer);
    }
  };

  return {
    start,
    close,
    rootDir,
    emit: addChange,
    stats: () => ({
      watchers: watchers.size,
      pending: pending.size,
      native: nativeBuffer.stats()
    })
  };
};
