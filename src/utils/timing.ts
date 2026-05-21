export const now = (): number => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

export const sleep = (milliseconds: number): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, milliseconds);
});

export const createStopwatch = (): { start: number; elapsed: () => number; reset: () => void } => {
  let start = now();

  return {
    get start() {
      return start;
    },
    elapsed() {
      return now() - start;
    },
    reset() {
      start = now();
    }
  };
};