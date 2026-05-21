export const debounce = <TArgs extends readonly unknown[]>(fn: (...args: TArgs) => void, delay = 150) => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return (...args: TArgs) => {
    if (timer) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => fn(...args), delay);
  };
};

export const throttle = <TArgs extends readonly unknown[]>(fn: (...args: TArgs) => void, interval = 150) => {
  let lastRun = 0;
  let scheduled: ReturnType<typeof setTimeout> | undefined;

  return (...args: TArgs) => {
    const now = Date.now();
    const remaining = interval - (now - lastRun);

    if (remaining <= 0) {
      lastRun = now;
      fn(...args);
      return;
    }

    if (scheduled) {
      clearTimeout(scheduled);
    }

    scheduled = setTimeout(() => {
      lastRun = Date.now();
      fn(...args);
    }, remaining);
  };
};
