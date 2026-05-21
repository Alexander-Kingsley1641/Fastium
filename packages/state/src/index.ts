import type { Signal, Store } from '@alexium/types';

export const createSignal = <T>(initial: T): Signal<T> => {
  let value = initial;
  const listeners = new Set<(value: T) => void>();

  return {
    get() {
      return value;
    },
    set(next) {
      if (Object.is(next, value)) {
        return;
      }

      value = next;
      for (const listener of listeners) {
        listener(value);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
};

export const createStore = <TState extends Record<string, unknown>>(state: TState): Store<TState> => {
  const signal = createSignal(state);
  return {
    getState() {
      return signal.get();
    },
    setState(updater) {
      const current = signal.get();
      const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
      signal.set(next);
    },
    subscribe(listener) {
      return signal.subscribe(listener);
    }
  };
};

export const computed = <T>(getter: () => T) => {
  const signal = createSignal(getter());
  return {
    get: signal.get,
    refresh() {
      signal.set(getter());
      return signal.get();
    },
    subscribe: signal.subscribe
  };
};

export const createReducerStore = <TState extends Record<string, unknown>, TAction>(
  initialState: TState,
  reducer: (state: TState, action: TAction) => TState
) => {
  const store = createStore(initialState);

  return {
    ...store,
    dispatch(action: TAction) {
      store.setState(current => reducer(current, action));
    }
  };
};
