import path from 'node:path';

import { CompilerTransform } from './transforms.js';

const normalizeModuleId = (filePath: string): string => {
  const moduleId = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
  return moduleId.startsWith('./') ? moduleId.slice(2) : moduleId;
};

export const createHmrTransform = (): CompilerTransform => {
  return (source, context) => {
    if (!context.filePath) {
      return source;
    }

    const moduleId = normalizeModuleId(context.filePath);
    return `${source}

if (typeof window !== 'undefined' && window.__FASTIUM_HMR__) {
  window.__FASTIUM_HMR__.registerModule(${JSON.stringify(moduleId)}, {
    accept: (handler) => window.__FASTIUM_HMR__.accept(${JSON.stringify(moduleId)}, handler),
    dispose: (callback) => window.__FASTIUM_HMR__.dispose(${JSON.stringify(moduleId)}, callback)
  });
}
`;
  };
};
