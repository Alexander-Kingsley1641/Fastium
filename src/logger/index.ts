import { ansi, colorize } from '../utils/index.js';

export interface LoggerOptions {
  scope?: string;
  debug?: boolean;
}

export interface Logger {
  scope: string;
  info: (...messages: unknown[]) => void;
  warn: (...messages: unknown[]) => void;
  error: (...messages: unknown[]) => void;
  success: (...messages: unknown[]) => void;
  debug: (...messages: unknown[]) => void;
  child: (scope: string) => Logger;
}

const formatValue = (value: unknown): string => {
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const formatLine = (scope: string, level: string, messages: unknown[]): string => {
  const stamp = new Date().toISOString();
  const prefix = colorize(`${stamp} ${scope} ${level}`, ansi.gray);
  return `${prefix} ${messages.map(formatValue).join(' ')}`;
};

export const createLogger = (options: LoggerOptions = {}): Logger => {
  const scope = options.scope ?? 'fastium';
  const enabledDebug = options.debug ?? false;

  const logger: Logger = {
    scope,
    info(...messages: unknown[]) {
      console.log(formatLine(scope, colorize('info', ansi.cyan), messages));
    },
    warn(...messages: unknown[]) {
      console.warn(formatLine(scope, colorize('warn', ansi.yellow), messages));
    },
    error(...messages: unknown[]) {
      console.error(formatLine(scope, colorize('error', ansi.red), messages));
    },
    success(...messages: unknown[]) {
      console.log(formatLine(scope, colorize('ok', ansi.green), messages));
    },
    debug(...messages: unknown[]) {
      if (enabledDebug) {
        console.debug(formatLine(scope, colorize('debug', ansi.magenta), messages));
      }
    },
    child(childScope: string) {
      return createLogger({ scope: `${scope}:${childScope}`, debug: enabledDebug });
    }
  };

  return logger;
};