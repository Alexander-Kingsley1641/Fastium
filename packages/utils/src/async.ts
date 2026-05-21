export const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export const timeout = async <T>(promise: Promise<T>, ms: number, message = 'Operation timed out'): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  try {
    return await Promise.race([promise, guard]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

export const retry = async <T>(fn: () => Promise<T>, attempts = 3, delayMs = 100): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) {
        await sleep(delayMs * (attempt + 1));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Retry failed');
};
