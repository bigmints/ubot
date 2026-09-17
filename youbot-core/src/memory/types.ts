/**
 * Memory Store Types
 *
 * Shared type definitions for the YOUBOT memory system.
 * These were extracted from memory-store.ts to enable reuse
 * across memory utilities and tests.
 */

export type MemoryCategory =
  | "identity"
  | "preference"
  | "fact"
  | "relationship"
  | "note"
  | "summary";

export interface MemoryEntry {
  id: string;
  contactId: string;
  category: MemoryCategory;
  key: string;
  value: string;
  source: string;
  confidence: number;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date | null;
}

export interface SoulDocument {
  id: string;
  personaId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}
