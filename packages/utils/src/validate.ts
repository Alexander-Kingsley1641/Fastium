export const isString = (value: unknown): value is string => typeof value === 'string';
export const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export const createValidator = <T>(check: (value: unknown) => value is T) => {
  return {
    parse(value: unknown): T {
      if (!check(value)) {
        throw new Error('Validation failed');
      }

      return value;
    },
    safeParse(value: unknown): { success: boolean; data?: T; error?: Error } {
      if (check(value)) {
        return { success: true, data: value };
      }

      return { success: false, error: new Error('Validation failed') };
    }
  };
};
