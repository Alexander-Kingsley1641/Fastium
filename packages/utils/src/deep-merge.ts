export type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

export const deepMerge = <T extends PlainObject>(target: T, ...sources: readonly PlainObject[]): T => {
  const output: PlainObject = { ...target };

  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      const current = output[key];

      if (isPlainObject(current) && isPlainObject(value)) {
        output[key] = deepMerge(current, value);
        continue;
      }

      if (Array.isArray(current) && Array.isArray(value)) {
        output[key] = [...current, ...value];
        continue;
      }

      output[key] = value;
    }
  }

  return output as T;
};
