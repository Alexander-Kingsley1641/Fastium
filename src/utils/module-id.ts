import path from 'node:path';

const stripQueryAndHash = (id: string): string => {
  const queryIndex = id.search(/[?#]/u);
  return queryIndex >= 0 ? id.slice(0, queryIndex) : id;
};

const slashNormalize = (value: string): string => value.replace(/\\/g, '/');

export const normalizeModuleId = (root: string, id: string): string => {
  const cleanId = stripQueryAndHash(id);
  const cleanRoot = stripQueryAndHash(root);
  const absolute = path.isAbsolute(cleanId) ? path.resolve(cleanId) : path.resolve(cleanRoot, cleanId);
  const normalized = slashNormalize(absolute);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
};

export const toPublicModuleId = (root: string, id: string): string => {
  const normalizedRoot = normalizeModuleId(root, root);
  const normalizedId = normalizeModuleId(root, id);
  const relative = normalizedId.startsWith(normalizedRoot)
    ? normalizedId.slice(normalizedRoot.length).replace(/^\/+/u, '')
    : normalizedId;
  return slashNormalize(relative || path.basename(normalizedId));
};
