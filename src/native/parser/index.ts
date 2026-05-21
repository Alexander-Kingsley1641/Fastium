export { parseFastSource } from '../../parser/index.js';
export { lex } from '../../lexer/index.js';

export interface NativeImportRecord {
  specifier: string;
  start: number;
  end: number;
  dynamic: boolean;
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

const isQuote = (value: number): boolean => value === 34 || value === 39 || value === 96;
const isWhitespace = (value: number): boolean => value === 32 || value === 9 || value === 10 || value === 13;

const readQuoted = (bytes: Uint8Array, quoteIndex: number): NativeImportRecord | undefined => {
  const quote = bytes[quoteIndex];
  if (!isQuote(quote ?? 0)) {
    return undefined;
  }

  let index = quoteIndex + 1;
  while (index < bytes.length) {
    const value = bytes[index];
    if (value === 92) {
      index += 2;
      continue;
    }

    if (value === quote) {
      return {
        specifier: decoder.decode(bytes.subarray(quoteIndex + 1, index)),
        start: quoteIndex + 1,
        end: index,
        dynamic: false
      };
    }

    index += 1;
  }

  return undefined;
};

export const scanImportsNative = (source: string | Uint8Array): NativeImportRecord[] => {
  const bytes = typeof source === 'string' ? encoder.encode(source) : source;
  const imports: NativeImportRecord[] = [];

  for (let index = 0; index < bytes.length; index += 1) {
    const current = bytes[index];
    if (current !== 105 && current !== 101) {
      continue;
    }

    const word = decoder.decode(bytes.subarray(index, Math.min(index + 6, bytes.length)));
    const isImport = word.startsWith('import');
    const isExport = word.startsWith('export');
    if (!isImport && !isExport) {
      continue;
    }

    let cursor = index + (isImport ? 6 : 6);
    while (cursor < bytes.length && !isQuote(bytes[cursor] ?? 0)) {
      if (isImport && bytes[cursor] === 40) {
        cursor += 1;
        while (cursor < bytes.length && isWhitespace(bytes[cursor] ?? 0)) cursor += 1;
        const dynamicRecord = readQuoted(bytes, cursor);
        if (dynamicRecord) {
          imports.push({ ...dynamicRecord, dynamic: true });
        }
        break;
      }

      if ((bytes[cursor] ?? 0) === 59 || (bytes[cursor] ?? 0) === 10) {
        break;
      }

      cursor += 1;
    }

    const record = readQuoted(bytes, cursor);
    if (record) {
      imports.push(record);
    }
  }

  return imports;
};

export const scanImportSpecifiersNative = (source: string | Uint8Array): string[] => {
  const unique = new Set<string>();
  for (const record of scanImportsNative(source)) {
    unique.add(record.specifier);
  }

  return Array.from(unique);
};
