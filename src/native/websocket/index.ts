export { decodeWebSocketFrame, decodeWebSocketFrames, encodeWebSocketFrame, WebSocketFrameDecoder } from '../../websocket/index.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface NativeRuntimePacket {
  type: number;
  id: number;
  timestamp: number;
  payload: Uint8Array;
}

export const encodeRuntimePacketNative = (type: number, id: number, payload: string | Uint8Array, timestamp = Date.now()): Uint8Array => {
  const payloadBytes = typeof payload === 'string' ? encoder.encode(payload) : payload;
  const buffer = new Uint8Array(17 + payloadBytes.length);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setUint8(0, type & 0xff);
  view.setUint32(1, id >>> 0, false);
  view.setFloat64(5, timestamp, false);
  view.setUint32(13, payloadBytes.byteLength, false);
  buffer.set(payloadBytes, 17);
  return buffer;
};

export const decodeRuntimePacketNative = (buffer: Uint8Array): NativeRuntimePacket | undefined => {
  if (buffer.byteLength < 17) {
    return undefined;
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const length = view.getUint32(13, false);
  if (17 + length > buffer.byteLength) {
    return undefined;
  }

  return {
    type: view.getUint8(0),
    id: view.getUint32(1, false),
    timestamp: view.getFloat64(5, false),
    payload: buffer.subarray(17, 17 + length)
  };
};

export const decodeRuntimePacketTextNative = (packet: NativeRuntimePacket): string => decoder.decode(packet.payload);
