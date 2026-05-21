const palette = {
  reset: '\u001b[0m',
  black: '\u001b[30m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
  gray: '\u001b[90m',
  bold: '\u001b[1m',
  dim: '\u001b[2m'
} as const;

const paint = (code: string, value: string) => `${code}${value}${palette.reset}`;

export const color = {
  reset: (value: string) => paint(palette.reset, value),
  bold: (value: string) => paint(palette.bold, value),
  dim: (value: string) => paint(palette.dim, value),
  red: (value: string) => paint(palette.red, value),
  green: (value: string) => paint(palette.green, value),
  yellow: (value: string) => paint(palette.yellow, value),
  blue: (value: string) => paint(palette.blue, value),
  magenta: (value: string) => paint(palette.magenta, value),
  cyan: (value: string) => paint(palette.cyan, value),
  gray: (value: string) => paint(palette.gray, value)
};
