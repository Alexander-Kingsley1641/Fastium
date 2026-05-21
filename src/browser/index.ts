import { spawn } from 'node:child_process';
import process from 'node:process';

import { createLogger, type Logger } from '../logger/index.js';

export interface BrowserSession {
  url: string;
  openedAt: number;
  diagnosticsEnabled: boolean;
  hmrEnabled: boolean;
}

export interface BrowserBridgeOptions {
  logger?: Logger;
}

const openExternalUrl = async (url: string): Promise<void> => {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
};

export const createBrowserBridge = (options: BrowserBridgeOptions = {}) => {
  const logger = options.logger ?? createLogger({ scope: 'fastium:browser', debug: false });
  const sessions = new Map<string, BrowserSession>();

  const open = async (url: string, diagnosticsEnabled = true, hmrEnabled = true): Promise<BrowserSession> => {
    await openExternalUrl(url);
    const session: BrowserSession = {
      url,
      openedAt: Date.now(),
      diagnosticsEnabled,
      hmrEnabled
    };

    sessions.set(url, session);
    logger.info('opened browser', url);
    return session;
  };

  return {
    open,
    sessions,
    attach: (url: string) => sessions.get(url),
    close: (url: string) => {
      sessions.delete(url);
    }
  };
};