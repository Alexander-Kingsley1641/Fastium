import { createEventBus, randomId } from '../utils/index.js';
import { createLogger, type Logger } from '../logger/index.js';

export interface HmrPacket {
  type: 'update' | 'invalidate' | 'reload' | 'error' | 'state' | 'batch' | 'log' | 'graph';
  moduleId?: string;
  payload?: unknown;
  timestamp: number;
  batchId?: string;
  sequence?: number;
}

export interface HmrOptions {
  logger?: Logger;
  maxHistory?: number;
}

export const createHmrRuntime = (options: HmrOptions = {}) => {
  const logger = options.logger ?? createLogger({ scope: 'fastium:hmr', debug: false });
  const events = createEventBus<{ packet: HmrPacket; connected: undefined; disconnected: undefined }>();
  const state = new Map<string, unknown>();
  const history: HmrPacket[] = [];
  let sequence = 0;

  const record = (packet: HmrPacket): HmrPacket => {
    const next = { ...packet, sequence: ++sequence };
    history.push(next);
    const maxHistory = options.maxHistory ?? 128;
    if (history.length > maxHistory) {
      history.splice(0, history.length - maxHistory);
    }

    void events.emit('packet', next);
    return next;
  };

  return {
    id: randomId('hmr'),
    events,
    state,
    remember(moduleId: string, value: unknown) {
      state.set(moduleId, value);
      record({ type: 'state', moduleId, payload: value, timestamp: Date.now() });
      return value;
    },
    restore<T>(moduleId: string): T | undefined {
      return state.get(moduleId) as T | undefined;
    },
    invalidate(moduleId: string, payload: unknown = { reason: 'file-changed' }) {
      const packet: HmrPacket = { type: 'invalidate', moduleId, payload, timestamp: Date.now() };
      logger.debug('invalidate', moduleId);
      return record(packet);
    },
    update(moduleId: string, payload: unknown) {
      const prev = state.get(moduleId);
      const packet: HmrPacket = { type: 'update', moduleId, payload: { value: payload, __prevState: prev }, timestamp: Date.now() };
      return record(packet);
    },
    batch(packets: Array<Omit<HmrPacket, 'timestamp' | 'batchId' | 'sequence'> & Partial<Pick<HmrPacket, 'timestamp'>>>): HmrPacket {
      const batchId = randomId('patch');
      const normalized = packets.map(packet => ({
        ...packet,
        timestamp: packet.timestamp ?? Date.now(),
        batchId
      }));
      return record({ type: 'batch', batchId, payload: normalized, timestamp: Date.now() });
    },
    rollback(moduleId: string, reason = 'rollback') {
      const prev = state.get(moduleId);
      const packet: HmrPacket = { type: 'update', moduleId, payload: { __rollback: true, __reason: reason, __prevState: prev }, timestamp: Date.now() };
      return record(packet);
    },
    reload(payload: unknown = { reason: 'manual' }) {
      const packet: HmrPacket = { type: 'reload', payload, timestamp: Date.now() };
      return record(packet);
    },
    reportError(error: Error) {
      const packet: HmrPacket = { type: 'error', payload: { message: error.message, stack: error.stack }, timestamp: Date.now() };
      return record(packet);
    },
    log(payload: unknown) {
      return record({ type: 'log', payload, timestamp: Date.now() });
    },
    graph(payload: unknown) {
      return record({ type: 'graph', payload, timestamp: Date.now() });
    },
    history() {
      return history.slice();
    },
    clearState() {
      state.clear();
      history.length = 0;
    }
  };
};
