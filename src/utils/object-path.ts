const normalizePath = (path: string): Array<string | number> => path
  .replace(/\[(\d+)\]/g, '.$1')
  .split('.')
  .filter(Boolean)
  .map(segment => (segment.match(/^\d+$/) ? Number(segment) : segment));

export const getObjectPath = <T = unknown>(target: unknown, path: string, fallback?: T): T => {
  const segments = normalizePath(path);
  let current: any = target;

  for (const segment of segments) {
    if (current == null) {
      return fallback as T;
    }

    current = current[segment as keyof typeof current];
  }

  return (current ?? fallback) as T;
};

export const setObjectPath = (target: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> => {
  const segments = normalizePath(path);
  let current: Record<string, unknown> = target;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isLast = index === segments.length - 1;

    if (isLast) {
      current[segment as string] = value;
      break;
    }

    const nextSegment = segments[index + 1];
    const nextValue = current[segment as string];
    if (typeof nextValue !== 'object' || nextValue === null) {
      current[segment as string] = typeof nextSegment === 'number' ? [] : {};
    }

    current = current[segment as string] as Record<string, unknown>;
  }

  return target;
};

export const deleteObjectPath = (target: Record<string, unknown>, path: string): boolean => {
  const segments = normalizePath(path);
  let current: any = target;

  for (let index = 0; index < segments.length - 1; index += 1) {
    current = current?.[segments[index] as keyof typeof current];
    if (current == null) {
      return false;
    }
  }

  const last = segments[segments.length - 1];
  if (current && Object.prototype.hasOwnProperty.call(current, last)) {
    delete current[last as keyof typeof current];
    return true;
  }

  return false;
};