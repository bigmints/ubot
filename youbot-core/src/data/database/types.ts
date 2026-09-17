import type { SupabaseClient } from '@supabase/supabase-js';

export interface DatabaseConfig {
  provider?: 'supabase' | 'sqlite';
  path?: string;
  supabase_url?: string;
  supabase_service_key?: string;
}

export type QueryResult = {
  changes: number | bigint;
  lastInsertRowid: number | bigint | string;
};

export interface DatabaseConnection {
  is_connected(): boolean;
  close(): Promise<void>;
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  get<T = any>(sql: string, params?: any[]): Promise<T | null>;
  execute(sql: string, params?: any[]): Promise<QueryResult>;
}

export interface DatabaseOptions {
  config: DatabaseConfig;
}

export type DatabaseEvent = 'open' | 'close' | 'error';
export type DatabaseEventListener = (event: DatabaseEvent, data?: unknown) => void;
