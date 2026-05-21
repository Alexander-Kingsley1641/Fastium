const ESCAPE = '\u001B[';
const RESET = `${ESCAPE}0m`;

const supportsColor = (): boolean => Boolean(typeof process !== 'undefined' && process.stdout?.isTTY);

export const ansi = {
  reset: RESET,
  bold: `${ESCAPE}1m`,
  dim: `${ESCAPE}2m`,
  red: `${ESCAPE}31m`,
  green: `${ESCAPE}32m`,
  yellow: `${ESCAPE}33m`,
  blue: `${ESCAPE}34m`,
  magenta: `${ESCAPE}35m`,
  cyan: `${ESCAPE}36m`,
  gray: `${ESCAPE}90m`
};

export const colorize = (text: string, color: string): string => (supportsColor() ? `${color}${text}${RESET}` : text);

export const formatDuration = (milliseconds: number): string => `${milliseconds.toFixed(1)}ms`;