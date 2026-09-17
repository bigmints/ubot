/**
 * Vault — Encrypted Secure Storage
 *
 * Provides AES-256-GCM encrypted storage for sensitive data and documents.
 * Owner-only. Data stored in workspace/vault/ as encrypted JSON files.
 * Key auto-generated on first use and stored in workspace/vault/.vault-key.
 */

import crypto from 'crypto';
import type { WorkspaceProvider } from '../../data/workspace-provider.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VaultItem {
  id: string;
  label: string;
  category: string;
  type: 'text' | 'document';
  /** For text items: the plaintext value */
  value?: string;
  /** For document items: original filename */
  filename?: string;
  /** For document items: MIME type */
  mimeType?: string;
  /** Optional tags / metadata */
  metadata?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

interface EncryptedPayload {
  iv: string;       // hex
  tag: string;      // hex
  data: string;     // hex (encrypted)
}

interface VaultIndex {
  items: Array<{
    id: string;
    label: string;
    category: string;
    type: 'text' | 'document';
    filename?: string;
    mimeType?: string;
    metadata?: Record<string, string>;
    createdAt: string;
    updatedAt: string;
  }>;
}

// ─── Vault Service ───────────────────────────────────────────────────────────

export class VaultService {
  private workspace: WorkspaceProvider;
  private vaultPrefix = 'vault';
  private encryptionKey: Buffer | null = null;

  constructor(workspace: WorkspaceProvider) {
    this.workspace = workspace;
  }

  /** Ensure vault key exists */
  private init(): void {
    if (!this.encryptionKey) {
      this.encryptionKey = this.loadOrCreateKey();
    }
  }

  /** Load existing key or generate a new one */
  private loadOrCreateKey(): Buffer {
    const keyPath = `${this.vaultPrefix}/.vault-key`;
    const existing = this.workspace.readFile(keyPath);
    if (existing) {
      return Buffer.from(existing.trim(), 'hex');
    }
    // Generate a random 256-bit key
    const key = crypto.randomBytes(32);
    this.workspace.writeFile(keyPath, key.toString('hex'));
    return key;
  }

  /** Encrypt data with AES-256-GCM */
  private encrypt(plaintext: string): EncryptedPayload {
    this.init();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey!, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return {
      iv: iv.toString('hex'),
      tag: tag.toString('hex'),
      data: encrypted,
    };
  }

  /** Decrypt data with AES-256-GCM */
  private decrypt(payload: EncryptedPayload): string {
    this.init();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey!,
      Buffer.from(payload.iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(payload.tag, 'hex'));
    let decrypted = decipher.update(payload.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /** Load the vault index */
  private loadIndex(): VaultIndex {
    this.init();
    const indexPath = `${this.vaultPrefix}/.vault-index`;
    const content = this.workspace.readFile(indexPath);
    if (!content) return { items: [] };
    try {
      const encrypted = JSON.parse(content) as EncryptedPayload;
      const json = this.decrypt(encrypted);
      return JSON.parse(json) as VaultIndex;
    } catch {
      return { items: [] };
    }
  }

  /** Save the vault index */
  private saveIndex(index: VaultIndex): void {
    const encrypted = this.encrypt(JSON.stringify(index));
    this.workspace.writeFile(`${this.vaultPrefix}/.vault-index`, JSON.stringify(encrypted));
  }

  /** Store a text item in the vault */
  store(label: string, value: string, category: string = 'general', metadata?: Record<string, string>): VaultItem {
    this.init();
    const index = this.loadIndex();
    const now = new Date().toISOString();

    // Check if label already exists — update if so
    const existing = index.items.find(i => i.label.toLowerCase() === label.toLowerCase());
    const id = existing?.id || crypto.randomUUID();

    const item: VaultItem = {
      id,
      label,
      category,
      type: 'text',
      value,
      metadata,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    // Encrypt and save the value
    const encrypted = this.encrypt(JSON.stringify({ value, metadata }));
    this.workspace.writeFile(`${this.vaultPrefix}/${id}.enc`, JSON.stringify(encrypted));

    // Update index
    if (existing) {
      Object.assign(existing, { label, category, type: 'text', metadata, updatedAt: now });
    } else {
      index.items.push({ id, label, category, type: 'text', metadata, createdAt: now, updatedAt: now });
    }
    this.saveIndex(index);

    return item;
  }

  /** Store a document (raw data) in the vault */
  storeDocument(
    label: string,
    data: Buffer,
    filename: string,
    category: string = 'documents',
    metadata?: Record<string, string>,
  ): VaultItem {
    this.init();
    const index = this.loadIndex();
    const now = new Date().toISOString();

    const ext = filename.includes('.') ? '.' + filename.split('.').pop()!.toLowerCase() : '';
    const mimeMap: Record<string, string> = {
      '.pdf': 'application/pdf',
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp',
      '.txt': 'text/plain', '.md': 'text/markdown',
      '.csv': 'text/csv', '.json': 'application/json',
    };
    const mimeType = mimeMap[ext] || 'application/octet-stream';

    const existing = index.items.find(i => i.label.toLowerCase() === label.toLowerCase());
    const id = existing?.id || crypto.randomUUID();

    // Encrypt and save
    const base64 = data.toString('base64');
    const encrypted = this.encrypt(JSON.stringify({ base64, filename, mimeType, metadata }));
    this.workspace.writeFile(`${this.vaultPrefix}/${id}.enc`, JSON.stringify(encrypted));

    const item: VaultItem = {
      id, label, category, type: 'document',
      filename, mimeType, metadata,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    if (existing) {
      Object.assign(existing, { label, category, type: 'document', filename, mimeType, metadata, updatedAt: now });
    } else {
      index.items.push({ id, label, category, type: 'document', filename, mimeType, metadata, createdAt: now, updatedAt: now });
    }
    this.saveIndex(index);

    return item;
  }

  /** Retrieve a vault item by label or ID */
  retrieve(labelOrId: string): VaultItem | null {
    this.init();
    const index = this.loadIndex();
    const entry = index.items.find(
      i => i.id === labelOrId || i.label.toLowerCase() === labelOrId.toLowerCase(),
    );
    if (!entry) return null;

    const encContent = this.workspace.readFile(`${this.vaultPrefix}/${entry.id}.enc`);
    if (!encContent) return null;

    try {
      const encrypted = JSON.parse(encContent) as EncryptedPayload;
      const decrypted = JSON.parse(this.decrypt(encrypted));

      const item: VaultItem = {
        ...entry,
        value: decrypted.value,
        metadata: decrypted.metadata || entry.metadata,
      };

      // For documents, include filename info but not the full base64 blob
      if (entry.type === 'document') {
        item.filename = decrypted.filename || entry.filename;
        item.mimeType = decrypted.mimeType || entry.mimeType;
        item.value = undefined; // Don't leak binary
      }

      return item;
    } catch {
      return null;
    }
  }

  /** Retrieve raw document data (for saving/exporting) */
  retrieveDocumentData(labelOrId: string): { buffer: Buffer; filename: string; mimeType: string } | null {
    this.init();
    const index = this.loadIndex();
    const entry = index.items.find(
      i => (i.id === labelOrId || i.label.toLowerCase() === labelOrId.toLowerCase()) && i.type === 'document',
    );
    if (!entry) return null;

    const encContent = this.workspace.readFile(`${this.vaultPrefix}/${entry.id}.enc`);
    if (!encContent) return null;

    try {
      const encrypted = JSON.parse(encContent) as EncryptedPayload;
      const decrypted = JSON.parse(this.decrypt(encrypted));
      return {
        buffer: Buffer.from(decrypted.base64, 'base64'),
        filename: decrypted.filename || 'file',
        mimeType: decrypted.mimeType || 'application/octet-stream',
      };
    } catch {
      return null;
    }
  }

  /** List vault items, optionally filtered by category */
  list(category?: string): VaultItem[] {
    this.init();
    const index = this.loadIndex();
    let items = index.items;
    if (category) {
      items = items.filter(i => i.category.toLowerCase() === category.toLowerCase());
    }
    // Return index entries without decrypting values (summary only)
    return items.map(i => ({
      ...i,
      value: undefined,
    }));
  }

  /** Search vault items by label keyword */
  search(query: string): VaultItem[] {
    const items = this.list();
    const q = query.toLowerCase();
    return items.filter(
      i => i.label.toLowerCase().includes(q) ||
           i.category.toLowerCase().includes(q) ||
           (i.filename && i.filename.toLowerCase().includes(q)),
    );
  }

  /** Delete a vault item by label or ID */
  delete(labelOrId: string): boolean {
    this.init();
    const index = this.loadIndex();
    const idx = index.items.findIndex(
      i => i.id === labelOrId || i.label.toLowerCase() === labelOrId.toLowerCase(),
    );
    if (idx === -1) return false;

    const entry = index.items[idx];
    this.workspace.delete(`${this.vaultPrefix}/${entry.id}.enc`);

    index.items.splice(idx, 1);
    this.saveIndex(index);
    return true;
  }

  /** Get vault statistics */
  stats(): { total: number; categories: Record<string, number>; textItems: number; documentItems: number } {
    const items = this.list();
    const categories: Record<string, number> = {};
    let textItems = 0;
    let documentItems = 0;

    for (const item of items) {
      categories[item.category] = (categories[item.category] || 0) + 1;
      if (item.type === 'text') textItems++;
      else documentItems++;
    }

    return { total: items.length, categories, textItems, documentItems };
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

let vaultInstance: VaultService | null = null;

export function getVaultService(workspace?: WorkspaceProvider): VaultService {
  if (!vaultInstance && workspace) {
    vaultInstance = new VaultService(workspace);
  }
  if (!vaultInstance) {
    throw new Error('Vault not initialized — workspace provider required');
  }
  return vaultInstance;
}

export function resetVaultService(): void {
  vaultInstance = null;
}
