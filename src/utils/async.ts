export const delay = (milliseconds: number): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, milliseconds);
});

export const microtask = (callback: () => void): void => {
  queueMicrotask(callback);
};

export const createTaskQueue = () => {
  const queue: Array<() => Promise<void> | void> = [];
  let active = false;

  const pump = async () => {
    if (active) {
      return;
    }

    active = true;
    while (queue.length > 0) {
      const task = queue.shift();
      if (task) {
        await task();
      }
    }
    active = false;
  };

  return {
    push(task: () => Promise<void> | void) {
      queue.push(task);
      void pump();
    },
    clear() {
      queue.length = 0;
    },
    size() {
      return queue.length;
    }
  };
};