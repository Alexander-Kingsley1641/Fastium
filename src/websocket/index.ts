import { createHash } from 'node:crypto';
import { Socket } from 'node:net';

export interface WebSocketFrame {
  fin: boolean;
  opcode: number;
  masked: boolean;
  payload: Uint8Array;
  byteLength?: number;
}

export interface WebSocketChannel {
  sendText: (message: string) => void;
  sendBinary: (data: Uint8Array) => void;
  ping: () => void;
  close: (code?: number, reason?: string) => void;
}

const MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export const createWebSocketAcceptKey = (key: string): string => createHash('sha1').update(`${key}${MAGIC}`).digest('base64');

export const encodeWebSocketFrame = (payload: string | Uint8Array, opcode = typeof payload === 'string' ? 1 : 2): Buffer => {
  const bytes = typeof payload === 'string' ? Buffer.from(payload) : Buffer.from(payload);
  const length = bytes.length;
  const header = length < 126 ? Buffer.alloc(2) : length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);

  header[0] = 0x80 | (opcode & 0x0f);
  if (length < 126) {
    header[1] = length;
  } else if (length < 65536) {
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }

  return Buffer.concat([header, bytes]);
};

export const decodeWebSocketFrame = (buffer: Buffer): WebSocketFrame | undefined => {
  if (buffer.length < 2) {
    return undefined;
  }

  const firstByte = buffer[0];
  const secondByte = buffer[1];
  const fin = Boolean(firstByte & 0x80);
  const opcode = firstByte & 0x0f;
  const masked = Boolean(secondByte & 0x80);
  let offset = 2;
  let payloadLength = secondByte & 0x7f;

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) {
      return undefined;
    }
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) {
      return undefined;
    }
    payloadLength = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }

  let mask: Buffer | undefined;
  if (masked) {
    if (buffer.length < offset + 4) {
      return undefined;
    }
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + payloadLength) {
    return undefined;
  }

  const payload = buffer.subarray(offset, offset + payloadLength);
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }

  return {
    fin,
    opcode,
    masked,
    payload: new Uint8Array(payload),
    byteLength: offset + payloadLength
  };
};

export const decodeWebSocketFrames = (buffer: Buffer): { frames: WebSocketFrame[]; remaining: Buffer } => {
  const frames: WebSocketFrame[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const frame = decodeWebSocketFrame(buffer.subarray(offset));
    if (!frame?.byteLength) {
      break;
    }

    frames.push(frame);
    offset += frame.byteLength;
  }

  return { frames, remaining: buffer.subarray(offset) };
};

export class WebSocketFrameDecoder {
  private buffer = Buffer.alloc(0);

  push(chunk: Buffer | Uint8Array): WebSocketFrame[] {
    this.buffer = this.buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([this.buffer, Buffer.from(chunk)]);
    const result = decodeWebSocketFrames(this.buffer);
    this.buffer = Buffer.from(result.remaining);
    return result.frames;
  }

  reset(): void {
    this.buffer = Buffer.alloc(0);
  }
}

export const createWebSocketEngine = () => {
  const sockets = new Set<Socket>();
  const lastSeen = new Map<Socket, number>();
  const PRUNE_INTERVAL = 30_000; // 30s
  const STALE_THRESHOLD = 120_000; // 2 minutes

  const pruneTimer = setInterval(() => {
    const now = Date.now();
    for (const [socket, t] of lastSeen.entries()) {
      if (now - t > STALE_THRESHOLD) {
        try { socket.destroy(); } catch {}
        lastSeen.delete(socket);
        sockets.delete(socket);
      }
    }
  }, PRUNE_INTERVAL);

  const add = (socket: Socket) => {
    sockets.add(socket);
    lastSeen.set(socket, Date.now());
    const decoder = new WebSocketFrameDecoder();
    socket.on('data', chunk => {
      lastSeen.set(socket, Date.now());
      for (const frame of decoder.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))) {
        if (frame.opcode === 0x08) {
          socket.end();
        } else if (frame.opcode === 0x09) {
          socket.write(encodeWebSocketFrame(frame.payload, 0x0a));
        }
      }
    });
    socket.once('close', () => {
      sockets.delete(socket);
      lastSeen.delete(socket);
      decoder.reset();
    });
  };

  const broadcast = (payload: string | Uint8Array): void => {
    const frame = encodeWebSocketFrame(payload);
    for (const socket of sockets) {
      socket.write(frame);
    }
  };

  const close = (code = 1000, reason = 'close'): void => {
    void code;
    const frame = encodeWebSocketFrame(Buffer.from(reason), 0x08);
    for (const socket of sockets) {
      socket.write(frame);
      socket.end();
    }
    sockets.clear();
    clearInterval(pruneTimer);
  };

  return {
    add,
    broadcast,
    close,
    clients: () => sockets.size,
    decode: decodeWebSocketFrame,
    encode: encodeWebSocketFrame,
    accept(requestKey: string, socket: Socket, head?: Buffer) {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${createWebSocketAcceptKey(requestKey)}\r\n\r\n`
      );

      if (head && head.length > 0) {
        socket.unshift(head);
      }

      add(socket);
    }
  };
};

export const createWebSocketChannel = (sendFrame: (frame: Buffer) => void): WebSocketChannel => {
  let queued: Buffer[] = [];
  let scheduled = false;

  const flush = () => {
    scheduled = false;
    for (const frame of queued) {
      sendFrame(frame);
    }
    queued = [];
  };

  const enqueue = (frame: Buffer) => {
    queued.push(frame);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  };

  return {
    sendText(message: string) {
      enqueue(encodeWebSocketFrame(message, 1));
    },
    sendBinary(data: Uint8Array) {
      enqueue(encodeWebSocketFrame(data, 2));
    },
    ping() {
      enqueue(encodeWebSocketFrame('', 9));
    },
    close(code = 1000, reason = 'fastium') {
      void code;
      const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
      payload.writeUInt16BE(1000, 0);
      payload.write(reason, 2);
      enqueue(encodeWebSocketFrame(payload, 8));
    }
  };
};
