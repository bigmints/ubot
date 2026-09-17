declare module 'node:crypto' {
  export function randomUUID(): string;
  export function createHash(algorithm: string): { update(value: string): { digest(encoding: 'hex'): string } };
}
declare module 'node:fs/promises' {
  export function mkdir(path: string, options?: { recursive?: boolean; mode?: number }): Promise<unknown>;
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  export function chmod(path: string, mode: number): Promise<void>;
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
  export function rename(oldPath: string, newPath: string): Promise<void>;
  export function writeFile(path: string, data: string, options: { encoding: 'utf8'; mode?: number; flag?: string }): Promise<void>;
}
declare module 'node:path' { export function dirname(path: string): string; }
declare const Buffer: { byteLength(value: string, encoding: 'utf8'): number };
