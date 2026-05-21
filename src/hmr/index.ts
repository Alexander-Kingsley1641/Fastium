import { createEventBus, randomId } from '../utils/index.js';
import { createLogger, type Logger } from '../logger/index.js';

export interface HmrPacket {
  type: 'update' | 'invalidate' | 'reload' | 'error' | 'state';
  moduleId?: string;
  payload?: unknown;
  timestamp: number;
}

export interface HmrOptions {
  logger?: Logger;
}

export const createHmrRuntime = (options: HmrOptions = {}) => {
  const logger = options.logger ?? createLogger({ scope: 'fastium:hmr', debug: false });
  const events = createEventBus<{ packet: HmrPacket; connected: undefined; disconnected: undefined }>();
  const state = new Map<string, unknown>();

  return {
    id: randomId('hmr'),
    events,
    state,
    remember(moduleId: string, value: unknown) {
      state.set(moduleId, value);
      void events.emit('packet', { type: 'state', moduleId, payload: value, timestamp: Date.now() });
      return value;
    },
    restore<T>(moduleId: string): T | undefined {
      return state.get(moduleId) as T | undefined;
    },
    invalidate(moduleId: string, payload: unknown = { reason: 'file-changed' }) {
      const packet: HmrPacket = { type: 'invalidate', moduleId, payload, timestamp: Date.now() };
      logger.debug('invalidate', moduleId);
      void events.emit('packet', packet);
      return packet;
    },
    update(moduleId: string, payload: unknown) {
      const prev = state.get(moduleId);
      const packet: HmrPacket = { type: 'update', moduleId, payload: { value: payload, __prevState: prev }, timestamp: Date.now() };
      void events.emit('packet', packet);
      return packet;
    },
    rollback(moduleId: string, reason = 'rollback') {
      const prev = state.get(moduleId);
      const packet: HmrPacket = { type: 'update', moduleId, payload: { __rollback: true, __reason: reason, __prevState: prev }, timestamp: Date.now() };
      void events.emit('packet', packet);
      return packet;
    },
    reload(payload: unknown = { reason: 'manual' }) {
      const packet: HmrPacket = { type: 'reload', payload, timestamp: Date.now() };
      void events.emit('packet', packet);
      return packet;
    },
    reportError(error: Error) {
      const packet: HmrPacket = { type: 'error', payload: { message: error.message, stack: error.stack }, timestamp: Date.now() };
      void events.emit('packet', packet);
      return packet;
    },
    clearState() {
      state.clear();
    }
  };
};