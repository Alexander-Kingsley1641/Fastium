const createRandomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
    return bytes;
  }

  for (let index = 0; index < length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }

  return bytes;
};

const toHex = (bytes: Uint8Array): string => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');

export const randomId = (prefix = 'fastium'): string => `${prefix}-${toHex(createRandomBytes(8))}`;
export const randomID = randomId;