/**
 * Workspace Provider Interface
 *
 * Abstracts file storage so the YOUBOT core can read/write workspace files
 * without knowing the storage backend. Local mode uses the filesystem;
 * cloud modes can swap in GCS, S3, or any other provider.
 *
 * All paths are relative to the workspace root (e.g. 'skills/my-skill/SKILL.md').
 * Providers handle path resolution internally.
 */

/* ─── Types ───────────────────────────────────────────────────────────────── */

export interface DirEntry {
  /** File or directory name (not full path) */
  name: string;
  /** True if this entry is a directory */
  isDirectory: boolean;
}

/* ─── Interface ───────────────────────────────────────────────────────────── */

export interface WorkspaceProvider {
  /** Read a file as UTF-8 text. Returns null if not found. */
  readFile(relativePath: string): string | null;

  /** Write UTF-8 text to a file. Creates parent directories as needed. */
  writeFile(relativePath: string, content: string): void;

  /** Read a file as a Buffer. Returns null if not found. */
  readBinary(relativePath: string): Buffer | null;

  /** Write binary data to a file. */
  writeBinary(relativePath: string, data: Buffer): void;

  /** Check if a file or directory exists. */
  exists(relativePath: string): boolean;

  /** Delete a file. Returns true if it existed and was deleted. */
  delete(relativePath: string): boolean;

  /** Delete a directory recursively. Returns true if it existed and was deleted. */
  deleteDir(relativePath: string): boolean;

  /** List entries (files and directories) in a directory. Returns [] if dir does not exist. */
  listDir(relativePath: string): DirEntry[];

  /**
   * Watch a file for changes. Optional — no-op for remote providers.
   * Returns a cleanup function to stop watching.
   */
  watch?(relativePath: string, callback: (event: 'change' | 'rename') => void): () => void;

  /** The resolved root path/URI (for logging and display). */
  readonly rootPath: string;
}
