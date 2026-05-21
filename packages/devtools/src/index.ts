import type { DevtoolsBridge } from '@alexium/types';
import { createLogger } from '@alexium/logger';
import { createEventBus, randomID } from '@alexium/utils';

export interface DevtoolsEvent {
  readonly id: string;
  readonly kind: string;
  readonly payload: unknown;
  readonly time: number;
}

export const createDevtoolsBridge = (scope = 'alexium'): DevtoolsBridge & { record(kind: string, payload: unknown): void } => {
  const logger = createLogger({ scope: `${scope}:devtools` });
  const events: DevtoolsEvent[] = [];
  const bus = createEventBus<{ event: DevtoolsEvent }>();
  const connected = typeof window !== 'undefined';
  function record(kind: string, payload: unknown) {
    const entry: DevtoolsEvent = {
      id: randomID('evt'),
      kind,
      payload,
      time: Date.now()
    };

    events.push(entry);
    bus.emit('event', entry);
    logger.debug(kind, payload);
  }
  const bridge = {
    connected,
    send(event: string, payload: unknown) {
      record(event, payload);
    },
    async inspect() {
      return events;
    },
    record
  };

  if (connected) {
    (window as Window & { __ALEXIUM_DEVTOOLS__?: typeof bridge }).__ALEXIUM_DEVTOOLS__ = bridge;
  }

  return bridge;
};
