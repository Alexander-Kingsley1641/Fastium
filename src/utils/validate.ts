export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
export const isString = (value: unknown): value is string => typeof value === 'string';
export const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const isFunction = (value: unknown): value is (...parameters: unknown[]) => unknown => typeof value === 'function';
export const isArray = Array.isArray;

export const assert = (condition: unknown, message: string): asserts condition => {
  if (!condition) {
    throw new Error(message);
  }
};