import type {
  DatabaseConfig,
  DatabaseConnection,
  DatabaseOptions,
} from './types.js';
import { SQLiteConnection } from './sqlite.js';

export function createConnection(options: DatabaseOptions): DatabaseConnection {
  return new SQLiteConnection(options);
}

export function createDefaultConfig(): DatabaseConfig {
  return {
    provider: 'sqlite',
  };
}