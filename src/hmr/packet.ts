import { HmrPacket } from './index.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Simple binary framing: [version:1][length:4BE][payload...]
export const encodeHmrPacket = (packet: HmrPacket): Uint8Array => {
  const json = JSON.stringify(packet);
  const body = encoder.encode(json);
  const buffer = new Uint8Array(1 + 4 + body.length);
  buffer[0] = 1; // version
  const view = new DataView(buffer.buffer);
  view.setUint32(1, body.length, false);
  buffer.set(body, 5);
  return buffer;
};

export const encodeHmrBatch = (packets: HmrPacket[]): Uint8Array => {
  const parts: Uint8Array[] = packets.map(p => encodeHmrPacket(p));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

export const decodeHmrPackets = (buffer: Uint8Array): HmrPacket[] => {
  const packets: HmrPacket[] = [];
  let offset = 0;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  while (offset + 5 <= buffer.length) {
    const version = view.getUint8(offset);
    if (version !== 1) break;
    const len = view.getUint32(offset + 1, false);
    const start = offset + 5;
    const end = start + len;
    if (end > buffer.length) break;
    const slice = buffer.subarray(start, end);
    try {
      const json = decoder.decode(slice);
      const pkt = JSON.parse(json) as HmrPacket;
      packets.push(pkt);
    } catch {
      // ignore
    }
    offset = end;
  }

  return packets;
};
