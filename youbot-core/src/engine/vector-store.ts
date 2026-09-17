import type { DatabaseConnection } from '../data/database/types.js';

export interface AgentMemoryMatch {
  id: string;
  sessionId: string;
  agentId: string;
  content: string;
  metadata: Record<string, any>;
  similarity: number;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function generateId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Persists and retrieves agent insights using SQLite
 */
export class VectorStore {
  private db: DatabaseConnection;

  constructor(db: DatabaseConnection) {
    this.db = db;
  }

  /** Insert a new semantic memory */
  async storeMemory(
    sessionId: string,
    agentId: string,
    content: string,
    embedding: number[],
    metadata: Record<string, any> = {}
  ): Promise<string | null> {
    const id = generateId();
    try {
      await this.db.execute(
        `INSERT INTO youbot_agent_memories (id, session_id, agent_id, content, embedding_json, metadata_json) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, sessionId, agentId, content, JSON.stringify(embedding), JSON.stringify(metadata)]
      );
      return id;
    } catch (error: any) {
      console.error(`[VectorStore] Failed to store memory:`, error.message);
      return null;
    }
  }

  /** Find similar memories using JS cosine similarity */
  async findSimilar(
    queryEmbedding: number[],
    matchThreshold: number = 0.75,
    matchCount: number = 5,
    filterSessionId?: string,
    filterAgentId?: string
  ): Promise<AgentMemoryMatch[]> {
    try {
      let query = `SELECT * FROM youbot_agent_memories WHERE 1=1`;
      const params: any[] = [];

      if (filterSessionId) {
        query += ` AND session_id = ?`;
        params.push(filterSessionId);
      }
      if (filterAgentId) {
        query += ` AND agent_id = ?`;
        params.push(filterAgentId);
      }

      const rows = await this.db.query(query, params);
      if (!rows) return [];

      const matches: AgentMemoryMatch[] = [];

      for (const row of rows) {
        try {
          const emb = JSON.parse(row.embedding_json);
          const similarity = cosineSimilarity(queryEmbedding, emb);
          
          if (similarity >= matchThreshold) {
            matches.push({
              id: row.id,
              sessionId: row.session_id,
              agentId: row.agent_id,
              content: row.content,
              metadata: JSON.parse(row.metadata_json || '{}'),
              similarity
            });
          }
        } catch (e) {
          // ignore parsing errors
        }
      }

      matches.sort((a, b) => b.similarity - a.similarity);
      return matches.slice(0, matchCount);
    } catch (error: any) {
      console.error(`[VectorStore] Similarity search failed:`, error.message);
      return [];
    }
  }
}
