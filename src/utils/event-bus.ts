export type EventMap = object;
export type EventHandler<T> = (payload: T) => void | Promise<void>;

export class EventBus<Events extends EventMap = Record<string, unknown>> {
  private readonly listeners = new Map<keyof Events & string, Set<EventHandler<unknown>>>();

  on<K extends keyof Events & string>(event: K, handler: EventHandler<Events[K]>): () => void {
    const listeners = this.listeners.get(event) ?? new Set<EventHandler<unknown>>();
    listeners.add(handler as EventHandler<unknown>);
    this.listeners.set(event, listeners);
    return () => this.off(event, handler);
  }

  once<K extends keyof Events & string>(event: K, handler: EventHandler<Events[K]>): () => void {
    const off = this.on(event, async payload => {
      off();
      await handler(payload as Events[K]);
    });
    return off;
  }

  off<K extends keyof Events & string>(event: K, handler: EventHandler<Events[K]>): void {
    const listeners = this.listeners.get(event);
    if (!listeners) {
      return;
    }

    listeners.delete(handler as EventHandler<unknown>);
    if (listeners.size === 0) {
      this.listeners.delete(event);
    }
  }

  async emit<K extends keyof Events & string>(event: K, payload: Events[K]): Promise<void> {
    const listeners = this.listeners.get(event);
    if (!listeners) {
      return;
    }

    for (const handler of listeners) {
      await handler(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }

  listenerCount<K extends keyof Events & string>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

export const createEventBus = <Events extends EventMap = EventMap>() => new EventBus<Events>();