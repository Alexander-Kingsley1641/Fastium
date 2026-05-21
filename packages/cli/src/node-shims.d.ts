declare module 'node:fs/promises' {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  export interface Dirent {
    name: string;
    isDirectory(): boolean;
  }
  export function readdir(path: string, options?: { withFileTypes?: boolean }): Promise<Dirent[]>;
  export function readFile(path: string, encoding?: BufferEncoding): Promise<string>;
  export function stat(path: string): Promise<{ isDirectory(): boolean; isFile(): boolean }>;
  export function writeFile(path: string, data: string | Uint8Array): Promise<void>;
  export function copyFile(source: string, destination: string): Promise<void>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
}

declare module 'node:path' {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
}

declare module 'node:process' {
  export const argv: string[];
  export const version: string;
  export const stdin: NodeJS.ReadStream;
  export const stdout: NodeJS.WriteStream;
  export function cwd(): string;
  const process: { argv: string[]; version: string; stdin: NodeJS.ReadStream; stdout: NodeJS.WriteStream; cwd(): string };
  export default process;
}

declare module 'node:readline/promises' {
  export function createInterface(options: { input: NodeJS.ReadStream; output: NodeJS.WriteStream }): { question(question: string): Promise<string>; close(): void };
}

declare namespace NodeJS {
  interface ReadStream {}
  interface WriteStream {}
}
