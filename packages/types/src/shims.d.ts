declare module 'chokidar' {
  export interface FSWatcher {
    on(event: string, listener: (...args: unknown[]) => void): FSWatcher;
    close(): Promise<void>;
  }

  export interface WatchOptions {
    ignored?: string | readonly string[] | ((path: string) => boolean);
    ignoreInitial?: boolean;
    persistent?: boolean;
    depth?: number;
  }

  export default function watch(paths: string | readonly string[], options?: WatchOptions): FSWatcher;
}

declare module 'ws' {
  export class WebSocket {
    static OPEN: number;
    constructor(url: string | URL, protocols?: string | readonly string[]);
    readyState: number;
    send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
    close(code?: number, reason?: string): void;
    addEventListener(type: string, listener: (...args: unknown[]) => void): void;
  }

  export class WebSocketServer {
    constructor(options?: { port?: number; server?: unknown });
    on(event: 'connection', listener: (socket: WebSocket, request: unknown) => void): void;
    on(event: 'error', listener: (error: Error) => void): void;
    on(event: 'listening', listener: () => void): void;
    close(): Promise<void> | void;
    clients: Set<WebSocket>;
  }

  export default WebSocket;
}

declare module 'busboy' {
  export interface BusboyOptions {
    headers: Record<string, string | string[] | undefined>;
  }

  export default function Busboy(options: BusboyOptions): {
    on(event: 'file', listener: (fieldname: string, file: NodeJS.ReadableStream, info: { filename: string; mimeType: string }) => void): void;
    on(event: 'finish', listener: () => void): void;
    on(event: 'error', listener: (error: Error) => void): void;
    end(chunk?: Buffer): void;
  };
}

declare module 'node:fs/promises' {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  export function readdir(path: string, options?: { withFileTypes?: boolean }): Promise<unknown[]>;
  export function readFile(path: string, encoding?: BufferEncoding): Promise<string>;
  export function stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean }>;
  export function writeFile(path: string, data: string | Uint8Array): Promise<void>;
  export function copyFile(source: string, destination: string): Promise<void>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  export function access(path: string): Promise<void>;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

declare module 'node:process' {
  export const argv: string[];
  export const env: Record<string, string | undefined>;
  export const stdin: NodeJS.ReadStream;
  export const stdout: NodeJS.WriteStream;
  export function cwd(): string;
  const process: {
    argv: string[];
    env: Record<string, string | undefined>;
    stdin: NodeJS.ReadStream;
    stdout: NodeJS.WriteStream;
    cwd(): string;
  };
  export default process;
}

declare module 'node:readline/promises' {
  export function createInterface(options: { input: NodeJS.ReadStream; output: NodeJS.WriteStream }): { question(question: string): Promise<string>; close(): void };
}

declare module 'node:http' {
  export interface IncomingMessage {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    on(event: string, listener: (...args: unknown[]) => void): void;
    [Symbol.asyncIterator](): AsyncIterableIterator<Uint8Array | string>;
  }

  export interface ServerResponse {
    statusCode: number;
    setHeader(name: string, value: string): void;
    end(body?: string | Uint8Array): void;
  }

  export interface Server {
    listen(port: number, host: string, callback: () => void): void;
    close(callback: () => void): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
  }

  export function createServer(handler: (request: IncomingMessage, response: ServerResponse) => void): Server;
}

declare const Buffer: {
  from(input: string | Uint8Array): Uint8Array;
  alloc(size: number): Uint8Array;
  concat(buffers: readonly Uint8Array[]): Uint8Array;
  isBuffer(value: unknown): value is Uint8Array;
};

declare namespace NodeJS {
  interface ReadStream {}
  interface WriteStream {}
  interface ReadableStream {
    on(event: string, listener: (...args: unknown[]) => void): void;
  }
}
