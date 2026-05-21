import { createHash } from 'node:crypto';

export interface HashState {
  update: (chunk: string | Uint8Array) => HashState;
  digest: () => string;
}

export const fastHash = (input: string | Uint8Array): string => createHash('sha256').update(input).digest('hex');

const encoder = new TextEncoder();

export const fnv1a32 = (input: string | Uint8Array): number => {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index] ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
};

export const fastHash32 = (input: string | Uint8Array): string => fnv1a32(input).toString(16).padStart(8, '0');

export const hashBytesInto = (input: string | Uint8Array, target: Uint8Array): Uint8Array => {
  const hash = fnv1a32(input);
  if (target.length >= 4) {
    target[0] = hash >>> 24;
    target[1] = hash >>> 16;
    target[2] = hash >>> 8;
    target[3] = hash;
  }

  return target;
};

export const createHashState = (): HashState => {
  const hash = createHash('sha256');
  return {
    update(chunk) {
      hash.update(chunk);
      return this;
    },
    digest() {
      return hash.digest('hex');
    }
  };
};
