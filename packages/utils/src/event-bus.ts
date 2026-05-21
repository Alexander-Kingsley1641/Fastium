import type { EventBus, EventBusMap } from '@alexium/types';

export const createEventBus = <TEvents extends EventBusMap = EventBusMap>(): EventBus<TEvents> => {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();

  const on = <TKey extends keyof TEvents & string>(event: TKey, handler: (payload: TEvents[TKey]) => void) => {
    const handlers = listeners.get(event) ?? new Set<(payload: unknown) => void>();
    handlers.add(handler as (payload: unknown) => void);
    listeners.set(event, handlers);
    return () => handlers.delete(handler as (payload: unknown) => void);
  };

  const once = <TKey extends keyof TEvents & string>(event: TKey, handler: (payload: TEvents[TKey]) => void) => {
    const off = on(event, payload => {
      off();
      handler(payload);
    });
    return off;
  };

  const off = <TKey extends keyof TEvents & string>(event: TKey, handler: (payload: TEvents[TKey]) => void) => {
    listeners.get(event)?.delete(handler as (payload: unknown) => void);
  };

  const emit = <TKey extends keyof TEvents & string>(event: TKey, payload: TEvents[TKey]) => {
    const handlers = listeners.get(event);
    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      handler(payload);
    }
  };

  return { on, once, off, emit };
};
