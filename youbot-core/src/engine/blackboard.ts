export interface BlackboardEntry {
  key: string;
  value: any;
  author: string;
  timestamp: Date;
  expiresAt?: Date; // Optional TTL
}

export interface BlackboardKey {
  key: string;
  schema?: string;
  author: string;
  timestamp: Date;
  expiresAt?: Date;
}

export interface TypedBlackboardEntry extends BlackboardEntry {
  schema?: string;
}

/**
 * Shared Blackboard for Agent Context
 * An in-memory KV store allowing agents to share intermediate findings (e.g. Researcher dumps data here for Writer)
 */
export class Blackboard {
  private static instance: Blackboard;
  private store: Map<string, BlackboardEntry>;
  private schemas: Map<string, { schema: string; author: string; timestamp: Date }>;

  private constructor() {
    this.store = new Map();
    this.schemas = new Map();
  }

  public static getInstance(): Blackboard {
    if (!Blackboard.instance) {
      Blackboard.instance = new Blackboard();
    }
    return Blackboard.instance;
  }

  /** Write a value to the blackboard */
  public write(key: string, value: any, author: string, ttlSeconds?: number): void {
    const entry: BlackboardEntry = {
      key,
      value,
      author,
      timestamp: new Date()
    };

    if (ttlSeconds && ttlSeconds > 0) {
      entry.expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    }

    this.store.set(key, entry);
    console.log(`[Blackboard] ${author} wrote to '${key}' (TTL: ${ttlSeconds || 'infinite'})`);
  }

  /** Write a value with an associated schema description */
  public writeTyped(key: string, schema: string, value: any, author: string, ttlSeconds?: number): void {
    const entry: TypedBlackboardEntry = {
      key,
      value,
      author,
      timestamp: new Date(),
      schema
    };

    if (ttlSeconds && ttlSeconds > 0) {
      entry.expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    }

    this.store.set(key, entry);
    this.schemas.set(key, { schema, author, timestamp: entry.timestamp });
    console.log(`[Blackboard] ${author} typed-wrote to '${key}' with schema: '${schema}'`);
  }

  /** Read a value from the blackboard */
  public read(key: string): any | undefined {
    const entry = this.store.get(key);
    
    if (!entry) return undefined;

    // Check expiration
    if (entry.expiresAt && entry.expiresAt.getTime() < Date.now()) {
      this.store.delete(key);
      this.schemas.delete(key);
      console.log(`[Blackboard] Entry '${key}' expired. Automatically cleaned up.`);
      return undefined;
    }

    return entry.value;
  }

  /** Read a value with its schema metadata */
  public readTyped(key: string): { value: any; schema: string; author: string; timestamp: Date } | undefined {
    const entry = this.store.get(key);
    
    if (!entry) return undefined;

    // Check expiration
    if (entry.expiresAt && entry.expiresAt.getTime() < Date.now()) {
      this.store.delete(key);
      this.schemas.delete(key);
      console.log(`[Blackboard] Entry '${key}' expired. Automatically cleaned up.`);
      return undefined;
    }

    const schemaInfo = this.schemas.get(key);
    if (!schemaInfo) return undefined;

    return {
      value: entry.value,
      schema: schemaInfo.schema,
      author: schemaInfo.author,
      timestamp: schemaInfo.timestamp
    };
  }

  /** Read entire blackboard contents (useful for Manager context gathering) */
  public readAll(): Record<string, any> {
    const now = Date.now();
    const result: Record<string, any> = {};

    for (const [key, entry] of this.store.entries()) {
      if (entry.expiresAt && entry.expiresAt.getTime() < now) {
        this.store.delete(key);
      } else {
        result[key] = entry.value;
      }
    }

    return result;
  }

  /** Delete a specific entry */
  public delete(key: string): boolean {
    return this.store.delete(key);
  }

  /** List all keys with their schema info */
  public listKeys(): BlackboardKey[] {
    const now = Date.now();
    const result: BlackboardKey[] = [];

    for (const [key, entry] of this.store.entries()) {
      // Skip expired entries
      if (entry.expiresAt && entry.expiresAt.getTime() < now) {
        this.store.delete(key);
        this.schemas.delete(key);
        continue;
      }

      const schemaInfo = this.schemas.get(key);
      result.push({
        key,
        schema: schemaInfo?.schema,
        author: entry.author,
        timestamp: entry.timestamp,
        expiresAt: entry.expiresAt
      });
    }

    return result;
  }

  /** Get schema information for a specific key */
  public describeKey(key: string): { schema?: string; author: string; lastUpdated: Date } | null {
    const schemaInfo = this.schemas.get(key);
    if (!schemaInfo) return null;

    // Check if the entry is still valid
    const entry = this.store.get(key);
    if (!entry) {
      this.schemas.delete(key);
      return null;
    }

    if (entry.expiresAt && entry.expiresAt.getTime() < Date.now()) {
      this.store.delete(key);
      this.schemas.delete(key);
      return null;
    }

    return {
      schema: schemaInfo.schema,
      author: schemaInfo.author,
      lastUpdated: schemaInfo.timestamp
    };
  }

  /** Clear the entire blackboard (useful at the end of a big workflow session) */
  public clear(): void {
    this.store.clear();
    this.schemas.clear();
    console.log('[Blackboard] Cleared entirely.');
  }
}

export const blackboard = Blackboard.getInstance();
