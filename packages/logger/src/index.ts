import type { Logger, LoggerOptions, LogLevel } from '@alexium/types';
import { color, randomID } from '@alexium/utils';

const levels: readonly LogLevel[] = ['silent', 'error', 'warn', 'info', 'debug', 'trace'];

const isEnabled = (current: LogLevel, required: LogLevel) => {
  return levels.indexOf(current) >= levels.indexOf(required) && current !== 'silent';
};

const formatTime = () => new Date().toISOString();

const formatMessage = (scope: string, level: LogLevel, message: string, timestamps: boolean) => {
  const label = scope ? color.cyan(`[${scope}]`) : '';
  const stamp = timestamps ? `${color.gray(formatTime())} ` : '';
  const levelLabel = level === 'error'
    ? color.red(level.toUpperCase())
    : level === 'warn'
      ? color.yellow(level.toUpperCase())
      : level === 'debug' || level === 'trace'
        ? color.magenta(level.toUpperCase())
        : color.green(level.toUpperCase());

  return `${stamp}${levelLabel} ${label} ${message}`.trim();
};

export const createLogger = (options: LoggerOptions = {}): Logger => {
  const scope = options.scope ?? 'alexium';
  const level = options.level ?? (options.debug ? 'debug' : 'info');
  const timestamps = options.timestamps ?? true;
  const timers = new Map<string, number>();

  const write = (writeLevel: LogLevel, message: string, args: readonly unknown[] = []) => {
    if (!isEnabled(level, writeLevel)) {
      return;
    }

    const output = formatMessage(scope, writeLevel, message, timestamps);
    const writer = writeLevel === 'error' ? console.error : writeLevel === 'warn' ? console.warn : console.log;
    writer(output, ...args);

    if (options.trace && writeLevel === 'error') {
      writer(color.gray(new Error().stack ?? ''));
    }
  };

  const logger: Logger = {
    scope,
    level,
    debug(message, ...args) {
      write('debug', message, args);
    },
    info(message, ...args) {
      write('info', message, args);
    },
    warn(message, ...args) {
      write('warn', message, args);
    },
    error(message, ...args) {
      write('error', message, args);
    },
    success(message, ...args) {
      if (isEnabled(level, 'info')) {
        console.log(formatMessage(scope, 'info', color.green(message), timestamps), ...args);
      }
    },
    time(label) {
      timers.set(label, Date.now());
    },
    timeEnd(label) {
      const started = timers.get(label);
      if (!started) {
        return;
      }

      const elapsed = Date.now() - started;
      timers.delete(label);
      write('info', `${label} completed in ${elapsed}ms`);
    },
    child(childScope) {
      return createLogger({ ...options, scope: `${scope}:${childScope}` });
    }
  };

  return logger;
};

export const createScopedLogger = (scope: string, options: Omit<LoggerOptions, 'scope'> = {}) => createLogger({ ...options, scope });
export const createLoggerId = () => randomID('log');
