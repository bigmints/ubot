import { v4 as uuidv4 } from "uuid";
import type { DatabaseConnection } from "../data/database/types.js";
import type { MemoryCategory, MemoryEntry, SoulDocument } from "./types.js";
import { rowToMemory } from "./utils.js";


export interface MemoryStore {
	saveMemory(
		contactId: string,
		category: MemoryCategory,
		key: string,
		value: string,
		source?: string,
		confidence?: number,
		ttlSeconds?: number,
	): Promise<MemoryEntry>;
	getMemories(
		contactId: string,
		category?: MemoryCategory,
	): Promise<MemoryEntry[]>;
	getAllMemories(): Promise<MemoryEntry[]>;
	searchMemories(query: string): Promise<MemoryEntry[]>;
	deleteMemory(id: string): Promise<boolean>;
	clearContactMemories(contactId: string): Promise<void>;
	formatForPrompt(contactId: string): Promise<string>;

	getDocument(personaId: string): Promise<SoulDocument | null>;
	saveDocument(personaId: string, content: string): Promise<SoulDocument>;
	deleteDocument(personaId: string): Promise<boolean>;
	listDocuments(): Promise<SoulDocument[]>;
}

export function createMemoryStore(db: DatabaseConnection): MemoryStore {
	return {
		async saveMemory(
			contactId,
			category,
			key,
			value,
			source = "extracted",
			confidence = 0.8,
			ttlSeconds?: number,
		): Promise<MemoryEntry> {
			const now = new Date().toISOString();
			const expiresAt = ttlSeconds
				? new Date(Date.now() + ttlSeconds * 1000).toISOString()
				: null;
			const id = uuidv4();

			await db.execute(
				`INSERT INTO youbot_memories (id, contact_id, category, key, value, source, confidence, expires_at, created_at, updated_at) 
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(contact_id, category, key) 
				 DO UPDATE SET value = excluded.value, source = excluded.source, confidence = excluded.confidence, updated_at = excluded.updated_at, expires_at = excluded.expires_at`,
				[id, contactId, category, key, value, source, confidence, expiresAt, now, now]
			);

			const saved = await db.get(`SELECT * FROM youbot_memories WHERE contact_id = ? AND category = ? AND key = ?`, [contactId, category, key]);

			console.log(`[Memory] Saved/Updated: ${contactId} → ${category}/${key} = "${value}"`);
			return rowToMemory(saved!);
		},

		async getMemories(contactId, category?): Promise<MemoryEntry[]> {
			let sql = `SELECT * FROM youbot_memories WHERE contact_id = ? AND (expires_at IS NULL OR expires_at > ?)`;
			const params: any[] = [contactId, new Date().toISOString()];

			if (category) {
				sql += ` AND category = ?`;
				params.push(category);
			}

			sql += ` ORDER BY updated_at DESC`;
			const data = await db.query(sql, params);
			return data.map(rowToMemory);
		},

		async getAllMemories(): Promise<MemoryEntry[]> {
			const data = await db.query(`SELECT * FROM youbot_memories ORDER BY updated_at DESC`);
			return data.map(rowToMemory);
		},

		async searchMemories(query: string): Promise<MemoryEntry[]> {
			const data = await db.query(
				`SELECT * FROM youbot_memories WHERE value LIKE ? ORDER BY updated_at DESC`,
				[`%${query}%`]
			);
			return data.map(rowToMemory);
		},

		async deleteMemory(id: string): Promise<boolean> {
			try {
				await db.execute(`DELETE FROM youbot_memories WHERE id = ?`, [id]);
				return true;
			} catch (error) {
				return false;
			}
		},

		async clearContactMemories(contactId: string): Promise<void> {
			await db.execute(`DELETE FROM youbot_memories WHERE contact_id = ?`, [contactId]);
		},

		async formatForPrompt(contactId: string): Promise<string> {
			const memories = await this.getMemories(contactId, "fact");
			if (memories.length === 0) return "";

			const formatted = memories.map((m) => `${m.key}: ${m.value}`).join("\n");
			return `Memory facts for ${contactId}:\n${formatted}`;
		},

		async getDocument(personaId: string): Promise<SoulDocument | null> {
			const data = await db.get(`SELECT * FROM youbot_soul_documents WHERE persona_id = ?`, [personaId]);
			if (!data) return null;
			return {
				id: data.id || data.persona_id, // we changed schema to persona_id PK
				personaId: data.persona_id,
				content: data.content,
				createdAt: new Date(data.created_at),
				updatedAt: new Date(data.updated_at),
			};
		},

		async saveDocument(
			personaId: string,
			content: string,
		): Promise<SoulDocument> {
			const now = new Date().toISOString();
			try {
				await db.execute(
					`INSERT INTO youbot_soul_documents (persona_id, content, created_at, updated_at) VALUES (?, ?, ?, ?)
					 ON CONFLICT(persona_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`,
					[personaId, content, now, now]
				);

				const data = await db.get(`SELECT * FROM youbot_soul_documents WHERE persona_id = ?`, [personaId]);
				if (!data) throw new Error('Failed to retrieve saved document');

				return {
					id: data.persona_id,
					personaId: data.persona_id,
					content: data.content,
					createdAt: new Date(data.created_at),
					updatedAt: new Date(data.updated_at),
				};
			} catch (error: any) {
				throw new Error(
					`Failed to save document for ${personaId}: ${error?.message}`,
				);
			}
		},

		async deleteDocument(personaId: string): Promise<boolean> {
			try {
				await db.execute(`DELETE FROM youbot_soul_documents WHERE persona_id = ?`, [personaId]);
				return true;
			} catch (error) {
				return false;
			}
		},

		async listDocuments(): Promise<SoulDocument[]> {
			const data = await db.query(`SELECT * FROM youbot_soul_documents ORDER BY updated_at DESC`);
			return data.map((d: any) => ({
				id: d.persona_id,
				personaId: d.persona_id,
				content: d.content,
				createdAt: new Date(d.created_at),
				updatedAt: new Date(d.updated_at),
			}));
		},
	};
}
