import http from 'node:http';
import net from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import type { WebSocketConnection } from '@alexium/types';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const encodeFrame = (opcode: number, payload: Uint8Array = new Uint8Array(0)) => {
  const length = payload.byteLength;
  let headerLength = 2;

  if (length >= 126 && length <= 0xffff) {
    headerLength += 2;
  } else if (length > 0xffff) {
    headerLength += 8;
  }

  const frame = Buffer.allocUnsafe(headerLength + length);
  frame[0] = 0x80 | (opcode & 0x0f);

  if (length < 126) {
    frame[1] = length;
    if (length > 0) {
      frame.set(payload, 2);
    }
    return frame;
  }

  if (length <= 0xffff) {
    frame[1] = 126;
    frame.writeUInt16BE(length, 2);
    frame.set(payload, 4);
    return frame;
  }

  frame[1] = 127;
  frame.writeBigUInt64BE(BigInt(length), 2);
  frame.set(payload, 10);
  return frame;
};

const decodeText = (buffer: Uint8Array) => textDecoder.decode(buffer);

const toPayload = (data: string | Uint8Array) => typeof data === 'string' ? textEncoder.encode(data) : data;

export const acceptWebSocket = (request: http.IncomingMessage, socket: net.Socket, head: Buffer): WebSocketConnection | undefined => {
  const key = request.headers['sec-websocket-key'];
  if (typeof key !== 'string') {
    socket.destroy();
    return undefined;
  }

  const acceptKey = createHash('sha1').update(`${key}${GUID}`).digest('base64');
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`
  ].join('\r\n') + '\r\n\r\n');

  const connectionId = randomUUID();
  let readyState: 0 | 1 | 2 | 3 = 1;
  let buffer = head.length > 0 ? Buffer.from(head) : Buffer.alloc(0);
  const messageListeners = new Set<(data: string | Uint8Array) => void>();
  const closeListeners = new Set<(code: number, reason: string) => void>();

  const terminate = () => {
    readyState = 3;
    socket.destroy();
    messageListeners.clear();
    closeListeners.clear();
  };

  const close = (code = 1000, reason = '') => {
    if (readyState >= 2) {
      return;
    }

    readyState = 2;
    const reasonBytes = textEncoder.encode(reason);
    const payload = Buffer.allocUnsafe(2 + reasonBytes.length);
    payload.writeUInt16BE(code, 0);
    payload.set(reasonBytes, 2);
    socket.write(encodeFrame(0x8, payload));
    socket.end();
    readyState = 3;
    for (const listener of closeListeners) {
      listener(code, reason);
    }
    messageListeners.clear();
    closeListeners.clear();
  };

  const send = (data: string | Uint8Array) => {
    if (readyState !== 1) {
      return;
    }

    socket.write(encodeFrame(typeof data === 'string' ? 0x1 : 0x2, toPayload(data)));
  };

  const ping = (data: string | Uint8Array = new Uint8Array(0)) => socket.write(encodeFrame(0x9, toPayload(data)));
  const pong = (data: string | Uint8Array = new Uint8Array(0)) => socket.write(encodeFrame(0xA, toPayload(data)));

  const parse = () => {
    while (buffer.length >= 2) {
      const first = buffer[0];
      const second = buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let offset = 2;
      let length = second & 0x7f;

      if (length === 126) {
        if (buffer.length < 4) {
          return;
        }

        length = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (buffer.length < 10) {
          return;
        }

        const bigLength = buffer.readBigUInt64BE(offset);
        if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          terminate();
          return;
        }

        length = Number(bigLength);
        offset += 8;
      }

      const maskLength = masked ? 4 : 0;
      if (buffer.length < offset + maskLength + length) {
        return;
      }

      const mask = masked ? buffer.subarray(offset, offset + 4) : undefined;
      offset += maskLength;
      const payload = buffer.subarray(offset, offset + length);
      buffer = buffer.subarray(offset + length);

      if (opcode === 0x8) {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
        const reason = payload.length > 2 ? decodeText(payload.subarray(2)) : '';
        readyState = 3;
        socket.end();
        for (const listener of closeListeners) {
          listener(code, reason);
        }
        messageListeners.clear();
        closeListeners.clear();
        return;
      }

      if (opcode === 0x9) {
        pong(payload);
        continue;
      }

      if (opcode === 0xA) {
        continue;
      }

      const chunk = masked && mask ? Buffer.allocUnsafe(payload.length) : Buffer.from(payload);
      if (masked && mask) {
        for (let index = 0; index < payload.length; index += 1) {
          chunk[index] = payload[index] ^ mask[index & 3];
        }
      }

      const message = opcode === 0x1 ? decodeText(chunk) : chunk;
      for (const listener of messageListeners) {
        listener(message);
      }
    }
  };

  socket.on('data', chunk => {
    buffer = buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffer, chunk]);
    parse();
  });

  socket.on('close', () => {
    readyState = 3;
    for (const listener of closeListeners) {
      listener(1000, 'closed');
    }
    messageListeners.clear();
    closeListeners.clear();
  });

  return {
    id: connectionId,
    get readyState() {
      return readyState;
    },
    send,
    close,
    terminate,
    ping,
    pong,
    onMessage(listener: (data: string | Uint8Array) => void) {
      const typedListener = listener as (data: string | Uint8Array) => void;
      messageListeners.add(typedListener);
      return () => messageListeners.delete(typedListener);
    },
    onClose(listener: (code: number, reason: string) => void) {
      const typedListener = listener as (code: number, reason: string) => void;
      closeListeners.add(typedListener);
      return () => closeListeners.delete(typedListener);
    }
  };
};