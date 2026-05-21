export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const deepMerge = <T>(target: T, ...sources: Array<Partial<T> | undefined>): T => {
  const output: Record<string, unknown> = { ...(target as Record<string, unknown>) };

  for (const source of sources) {
    if (!source) {
      continue;
    }

    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      const existing = output[key];
      if (isPlainObject(existing) && isPlainObject(value)) {
        output[key] = deepMerge(existing, value);
      } else if (Array.isArray(value)) {
        output[key] = value.slice();
      } else {
        output[key] = value;
      }
    }
  }

  return output as T;
};