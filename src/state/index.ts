import { deepMerge } from '../utils/index.js';

export type Subscriber<T> = (value: T, previous: T) => void;

export class Signal<T> {
  private value: T;
  private readonly subscribers = new Set<Subscriber<T>>();

  constructor(initialValue: T) {
    this.value = initialValue;
  }

  get(): T {
    return this.value;
  }

  peek(): T {
    return this.value;
  }

  set(nextValue: T): void {
    const previous = this.value;
    if (Object.is(previous, nextValue)) {
      return;
    }

    this.value = nextValue;
    for (const subscriber of this.subscribers) {
      subscriber(nextValue, previous);
    }
  }

  update(updater: (current: T) => T): void {
    this.set(updater(this.value));
  }

  subscribe(subscriber: Subscriber<T>): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.value, this.value);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }
}

export const createSignal = <T>(initialValue: T): Signal<T> => new Signal(initialValue);

export const createComputed = <T>(compute: () => T, dependencies: Array<{ subscribe: (subscriber: Subscriber<unknown>) => () => void }> = []): Signal<T> => {
  const signal = createSignal(compute());
  const refresh = () => signal.set(compute());

  for (const dependency of dependencies) {
    dependency.subscribe(() => {
      refresh();
    });
  }

  return signal;
};

export const createStore = <T extends Record<string, unknown>>(initialValue: T) => {
  const signal = createSignal(initialValue);

  return {
    signal,
    get: () => signal.get(),
    peek: () => signal.peek(),
    set: (value: T) => signal.set(value),
    patch: (partial: Partial<T>) => signal.update(current => deepMerge(current, partial)),
    subscribe: (subscriber: Subscriber<T>) => signal.subscribe(subscriber)
  };
};