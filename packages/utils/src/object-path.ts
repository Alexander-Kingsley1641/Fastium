const isIndex = (segment: string) => /^\d+$/.test(segment);

export const getPath = (target: unknown, path: string, fallback?: unknown): unknown => {
  const segments = path.split('.').filter(Boolean);
  let current: unknown = target;

  for (const segment of segments) {
    if (current == null) {
      return fallback;
    }

    current = Array.isArray(current) && isIndex(segment)
      ? current[Number(segment)]
      : (current as Record<string, unknown>)[segment];
  }

  return current ?? fallback;
};

export const setPath = <T extends Record<string, unknown>>(target: T, path: string, value: unknown): T => {
  const segments = path.split('.').filter(Boolean);
  let current: Record<string, unknown> = target;

  while (segments.length > 1) {
    const segment = segments.shift() as string;
    const next = current[segment];
    if (typeof next !== 'object' || next === null) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  if (segments[0]) {
    current[segments[0]] = value;
  }

  return target;
};
