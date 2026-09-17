/**
 * Local Workspace Provider
 *
 * Filesystem-backed implementation of WorkspaceProvider.
 * Used in 'local' and 'cloud' modes where the process has
 * a persistent directory (YOUBOT_HOME/workspace or ./workspace).
 */

import fs from 'fs';
import path from 'path';
import type { WorkspaceProvider, DirEntry } from './workspace-provider.js';

export class LocalWorkspaceProvider implements WorkspaceProvider {
  readonly rootPath: string;

  constructor(basePath: string) {
    this.rootPath = path.resolve(basePath);
    // Ensure the root exists
    if (!fs.existsSync(this.rootPath)) {
      fs.mkdirSync(this.rootPath, { recursive: true });
    }
  }

  private resolve(relativePath: string): string {
    const resolved = path.resolve(this.rootPath, relativePath);
    // Security: prevent path traversal outside workspace
    if (!resolved.startsWith(this.rootPath)) {
      throw new Error(`Path traversal detected: ${relativePath}`);
    }
    return resolved;
  }

  readFile(relativePath: string): string | null {
    const fullPath = this.resolve(relativePath);
    if (!fs.existsSync(fullPath)) return null;
    try {
      return fs.readFileSync(fullPath, 'utf8');
    } catch {
      return null;
    }
  }

  writeFile(relativePath: string, content: string): void {
    const fullPath = this.resolve(relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, content, 'utf8');
  }

  readBinary(relativePath: string): Buffer | null {
    const fullPath = this.resolve(relativePath);
    if (!fs.existsSync(fullPath)) return null;
    try {
      return fs.readFileSync(fullPath);
    } catch {
      return null;
    }
  }

  writeBinary(relativePath: string, data: Buffer): void {
    const fullPath = this.resolve(relativePath);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, data);
  }

  exists(relativePath: string): boolean {
    return fs.existsSync(this.resolve(relativePath));
  }

  delete(relativePath: string): boolean {
    const fullPath = this.resolve(relativePath);
    if (!fs.existsSync(fullPath)) return false;
    try {
      fs.unlinkSync(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  deleteDir(relativePath: string): boolean {
    const fullPath = this.resolve(relativePath);
    if (!fs.existsSync(fullPath)) return false;
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  listDir(relativePath: string): DirEntry[] {
    const fullPath = this.resolve(relativePath);
    if (!fs.existsSync(fullPath)) return [];
    try {
      const entries = fs.readdirSync(fullPath, { withFileTypes: true });
      return entries
        .filter(e => !e.name.startsWith('.'))  // skip hidden files
        .map(e => ({
          name: e.name,
          isDirectory: e.isDirectory(),
        }));
    } catch {
      return [];
    }
  }

  watch(relativePath: string, callback: (event: 'change' | 'rename') => void): () => void {
    const fullPath = this.resolve(relativePath);
    if (!fs.existsSync(fullPath)) return () => {};
    try {
      const watcher = fs.watch(fullPath, (event) => {
        callback(event as 'change' | 'rename');
      });
      return () => watcher.close();
    } catch {
      return () => {};
    }
  }
}
