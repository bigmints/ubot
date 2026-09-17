import { v4 as uuidv4 } from 'uuid';
import type { DatabaseConnection } from './database/types.js';

export interface UniversalContact {
  id: string;
  displayName: string | null;
  type: string;
  tags: string[];
  metadata: Record<string, any>;
  createdAt: string;
}

export interface ContactIdentity {
  contactId: string;
  channel: string;
  platformId: string;
}

export class ContactStore {
  constructor(private db: DatabaseConnection) {}

  /**
   * Resolves a platform ID (like a WhatsApp JID) to a UniversalContact.
   * If it doesn't exist, it creates a new one automatically.
   */
  async resolveContact(channel: string, platformId: string, defaultName?: string, type: string = 'person'): Promise<UniversalContact> {
    // Check if identity exists
    const identity = await this.db.get<{contact_id: string}>(
      'SELECT contact_id FROM youbot_contact_identities WHERE channel = ? AND platform_id = ?',
      [channel, platformId]
    );

    if (identity) {
      return this.getContact(identity.contact_id) as Promise<UniversalContact>;
    }

    // Create new universal contact
    const newId = uuidv4();
    const displayName = defaultName || platformId;

    await this.db.execute(
      'INSERT INTO youbot_contacts (id, display_name, type, tags, metadata) VALUES (?, ?, ?, ?, ?)',
      [newId, displayName, type, '[]', '{}']
    );

    await this.db.execute(
      'INSERT INTO youbot_contact_identities (contact_id, channel, platform_id) VALUES (?, ?, ?)',
      [newId, channel, platformId]
    );

    return this.getContact(newId) as Promise<UniversalContact>;
  }

  /**
   * Fetches a contact by Universal ID
   */
  async getContact(id: string): Promise<UniversalContact | null> {
    const row = await this.db.get<any>('SELECT * FROM youbot_contacts WHERE id = ?', [id]);
    if (!row) return null;
    return {
      id: row.id,
      displayName: row.display_name,
      type: row.type,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []),
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}),
      createdAt: row.created_at
    };
  }

  /**
   * Updates a contact's display name, tags, or metadata
   */
  async updateContact(id: string, updates: { displayName?: string; tags?: string[]; metadata?: Record<string, any> }): Promise<void> {
    const contact = await this.getContact(id);
    if (!contact) throw new Error(`Contact ${id} not found`);

    const newDisplayName = updates.displayName !== undefined ? updates.displayName : contact.displayName;
    const newTags = updates.tags !== undefined ? updates.tags : contact.tags;
    const newMetadata = updates.metadata !== undefined ? { ...contact.metadata, ...updates.metadata } : contact.metadata;

    await this.db.execute(
      'UPDATE youbot_contacts SET display_name = ?, tags = ?, metadata = ? WHERE id = ?',
      [newDisplayName, JSON.stringify(newTags), JSON.stringify(newMetadata), id]
    );
  }

  /**
   * Merges contact B into contact A. All identities, memories, and follow-ups are moved to A. Contact B is deleted.
   */
  async mergeContacts(targetId: string, sourceId: string): Promise<void> {
    if (targetId === sourceId) return;

    // 1. Move identities
    await this.db.execute(
      'UPDATE OR REPLACE youbot_contact_identities SET contact_id = ? WHERE contact_id = ?',
      [targetId, sourceId]
    );

    // 2. Move memories
    await this.db.execute(
      'UPDATE youbot_memories SET contact_id = ? WHERE contact_id = ?',
      [targetId, sourceId]
    );

    // 3. Move follow ups
    await this.db.execute(
      'UPDATE youbot_follow_ups SET contact_id = ? WHERE contact_id = ?',
      [targetId, sourceId]
    );

    // 4. Merge metadata and tags
    const target = await this.getContact(targetId);
    const source = await this.getContact(sourceId);

    if (target && source) {
      const mergedTags = Array.from(new Set([...target.tags, ...source.tags]));
      const mergedMetadata = { ...source.metadata, ...target.metadata };
      await this.updateContact(targetId, { tags: mergedTags, metadata: mergedMetadata });
    }

    // 5. Delete source contact
    await this.db.execute('DELETE FROM youbot_contacts WHERE id = ?', [sourceId]);
  }

  /**
   * Searches contacts by name, tag, or metadata
   */
  async searchContacts(query: string): Promise<UniversalContact[]> {
    const rows = await this.db.query<any>(
      "SELECT * FROM youbot_contacts WHERE display_name LIKE ? OR tags LIKE ? OR metadata LIKE ? ORDER BY display_name ASC LIMIT 50",
      [`%${query}%`, `%${query}%`, `%${query}%`]
    );

    return rows.map(row => ({
      id: row.id,
      displayName: row.display_name,
      type: row.type,
      tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []),
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}),
      createdAt: row.created_at
    }));
  }

  /**
   * Get all identities associated with a contact
   */
  async getIdentities(contactId: string): Promise<ContactIdentity[]> {
    const rows = await this.db.query<any>(
      'SELECT channel, platform_id FROM youbot_contact_identities WHERE contact_id = ?',
      [contactId]
    );
    return rows.map(r => ({ contactId, channel: r.channel, platformId: r.platform_id }));
  }
}
