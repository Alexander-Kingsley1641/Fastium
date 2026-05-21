export type FastTokenType = 'identifier' | 'keyword' | 'number' | 'string' | 'punctuation' | 'eof';

export interface FastToken {
  type: FastTokenType;
  value: string;
  start: number;
  end: number;
  line: number;
  column: number;
}

const KEYWORDS = new Set([
  'import',
  'export',
  'from',
  'as',
  'const',
  'let',
  'var',
  'function',
  'class',
  'return',
  'if',
  'else',
  'for',
  'while',
  'async',
  'await',
  'new',
  'extends',
  'interface',
  'type',
  'enum',
  'default'
]);

const MULTI_PUNCTUATION = ['===', '!==', '=>', '??', '&&', '||', '??=', '&&=', '||=', '==', '!=', '<=', '>=', '++', '--', '...', '?.'];

const isDigit = (value: string): boolean => value >= '0' && value <= '9';
const isIdentifierStart = (value: string): boolean => /[A-Za-z_$]/.test(value);
const isIdentifierPart = (value: string): boolean => /[A-Za-z0-9_$]/.test(value);

export const lex = (source: string): FastToken[] => {
  const tokens: FastToken[] = [];
  let index = 0;
  let line = 1;
  let column = 1;

  const push = (type: FastTokenType, value: string, start: number, startLine: number, startColumn: number) => {
    tokens.push({ type, value, start, end: index, line: startLine, column: startColumn });
  };

  const advance = () => {
    const character = source[index];
    index += 1;
    if (character === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  };

  while (index < source.length) {
    const character = source[index];

    if (/\s/u.test(character)) {
      advance();
      continue;
    }

    if (character === '/' && source[index + 1] === '/') {
      while (index < source.length && source[index] !== '\n') {
        advance();
      }
      continue;
    }

    if (character === '/' && source[index + 1] === '*') {
      advance();
      advance();
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        advance();
      }
      advance();
      advance();
      continue;
    }

    const start = index;
    const startLine = line;
    const startColumn = column;

    if (character === '"' || character === '\'' || character === '`') {
      const quote = character;
      advance();
      while (index < source.length) {
        const next = source[index];
        if (next === '\\') {
          advance();
          advance();
          continue;
        }

        if (next === quote) {
          advance();
          break;
        }

        advance();
      }

      push('string', source.slice(start, index), start, startLine, startColumn);
      continue;
    }

    if (isDigit(character)) {
      advance();
      while (index < source.length && /[0-9._eExX]/u.test(source[index])) {
        advance();
      }

      push('number', source.slice(start, index), start, startLine, startColumn);
      continue;
    }

    if (isIdentifierStart(character)) {
      advance();
      while (index < source.length && isIdentifierPart(source[index])) {
        advance();
      }

      const value = source.slice(start, index);
      push(KEYWORDS.has(value) ? 'keyword' : 'identifier', value, start, startLine, startColumn);
      continue;
    }

    const punctuation = MULTI_PUNCTUATION.find(symbol => source.startsWith(symbol, index));
    if (punctuation) {
      for (let offset = 0; offset < punctuation.length; offset += 1) {
        advance();
      }

      push('punctuation', punctuation, start, startLine, startColumn);
      continue;
    }

    advance();
    push('punctuation', source.slice(start, index), start, startLine, startColumn);
  }

  tokens.push({ type: 'eof', value: '', start: index, end: index, line, column });
  return tokens;
};