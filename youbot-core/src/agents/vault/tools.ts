/**
 * Vault Tool Module
 *
 * Provides tools for storing, retrieving, listing, and deleting
 * sensitive information in the encrypted vault.
 * Owner-only (filtered by getToolsForSource).
 */

import type { ToolModule, ToolRegistry, ToolContext, ToolDefinition } from '../../tools/types.js';
import { getVaultService } from './service.js';
import { getSafetyService } from '../safety/service.js';
import { loadYoubotConfig } from '../../data/config.js';
import path from 'path';
import fs from 'fs';

const CATEGORIES = ['general', 'credentials', 'identity', 'finance', 'documents', 'keys', 'notes'];

const vaultTools: ToolDefinition[] = [
  {
    name: 'vault_store',
    description: `Store sensitive information securely in the encrypted vault. Use this for passwords, API keys, personal IDs, insurance details, or any sensitive text. Categories: ${CATEGORIES.join(', ')}.`,
    parameters: [
      { name: 'label', type: 'string', description: 'A short, memorable label for this item (e.g. "aws_access_key", "health_insurance_card")', required: true },
      { name: 'value', type: 'string', description: 'The sensitive text/value to store', required: true },
      { name: 'category', type: 'string', description: `Category: ${CATEGORIES.join(', ')} (default: general)`, required: false },
      { name: 'notes', type: 'string', description: 'Optional notes or context about this item', required: false },
    ],
  },
  {
    name: 'vault_store_document',
    description: 'Store a file (image, PDF, document) securely in the encrypted vault. The file will be encrypted and stored. Use for sensitive documents like IDs, contracts, certificates.',
    parameters: [
      { name: 'label', type: 'string', description: 'A short, memorable label for this document', required: true },
      { name: 'file_path', type: 'string', description: 'Path to the file to store (absolute or relative to workspace)', required: true },
      { name: 'category', type: 'string', description: `Category: ${CATEGORIES.join(', ')} (default: documents)`, required: false },
      { name: 'notes', type: 'string', description: 'Optional notes about this document', required: false },
    ],
  },
  {
    name: 'vault_retrieve',
    description: 'Retrieve a stored item from the encrypted vault by its label or ID. Returns the decrypted value for text items, or document metadata for files.',
    parameters: [
      { name: 'label', type: 'string', description: 'The label or ID of the vault item to retrieve', required: true },
    ],
  },
  {
    name: 'vault_list',
    description: `List all items in the encrypted vault. Shows labels, categories, and types but NOT the actual values. Optionally filter by category: ${CATEGORIES.join(', ')}.`,
    parameters: [
      { name: 'category', type: 'string', description: 'Optional: filter by category', required: false },
      { name: 'search', type: 'string', description: 'Optional: search by keyword in labels', required: false },
    ],
  },
  {
    name: 'vault_delete',
    description: 'Permanently delete an item from the encrypted vault by its label or ID. This cannot be undone.',
    parameters: [
      { name: 'label', type: 'string', description: 'The label or ID of the vault item to delete', required: true },
    ],
  },
];

const vaultToolModule: ToolModule = {
  name: 'vault',
  tools: vaultTools,
  register(registry: ToolRegistry, ctx: ToolContext) {
    const workspacePath = ctx.getWorkspacePath();
    const workspaceProvider = ctx.getWorkspaceProvider();
    if (!workspacePath && !workspaceProvider) {
      console.warn('[VaultTool] Workspace not defined. Vault tools disabled.');
      return;
    }

    const vault = getVaultService(workspaceProvider || undefined);
    const safety = getSafetyService();

    // ─── vault_store ─────────────────────────────────────────────────────
    registry.register('vault_store', async (args) => {
      const label = String(args.label || '').trim();
      const value = String(args.value || '');
      const category = String(args.category || 'general').toLowerCase();
      const notes = args.notes ? String(args.notes) : undefined;

      if (!label) {
        return { toolName: 'vault_store', success: false, error: 'Label is required', duration: 0 };
      }
      if (!value) {
        return { toolName: 'vault_store', success: false, error: 'Value is required', duration: 0 };
      }

      try {
        const metadata = notes ? { notes } : undefined;
        const item = vault.store(label, value, category, metadata);
        return {
          toolName: 'vault_store',
          success: true,
          result: `✅ Stored securely in vault: "${item.label}" [${item.category}] (ID: ${item.id})`,
          duration: 0,
        };
      } catch (err: any) {
        return { toolName: 'vault_store', success: false, error: err.message, duration: 0 };
      }
    });

    // ─── vault_store_document ────────────────────────────────────────────
    registry.register('vault_store_document', async (args) => {
      const label = String(args.label || '').trim();
      const filePath = String(args.file_path || '');
      const category = String(args.category || 'documents').toLowerCase();
      const notes = args.notes ? String(args.notes) : undefined;

      if (!label) {
        return { toolName: 'vault_store_document', success: false, error: 'Label is required', duration: 0 };
      }
      if (!filePath) {
        return { toolName: 'vault_store_document', success: false, error: 'File path is required', duration: 0 };
      }

      try {
        // Validate path security (only allow files within workspace)
        const safePath = safety.validatePathWithAllowedPaths(filePath, workspacePath || '', []);
        // Read the file from local filesystem (agent tool works with local files)
        const fileData = fs.readFileSync(safePath);
        const filename = path.basename(safePath);
        const metadata = notes ? { notes } : undefined;
        const item = vault.storeDocument(label, fileData, filename, category, metadata);
        return {
          toolName: 'vault_store_document',
          success: true,
          result: `✅ Document stored securely in vault: "${item.label}" [${item.category}] — ${item.filename} (${item.mimeType})`,
          duration: 0,
        };
      } catch (err: any) {
        return { toolName: 'vault_store_document', success: false, error: err.message, duration: 0 };
      }
    });

    // ─── vault_retrieve ──────────────────────────────────────────────────
    registry.register('vault_retrieve', async (args) => {
      const label = String(args.label || '').trim();

      if (!label) {
        return { toolName: 'vault_retrieve', success: false, error: 'Label or ID is required', duration: 0 };
      }

      try {
        const item = vault.retrieve(label);
        if (!item) {
          return {
            toolName: 'vault_retrieve',
            success: false,
            error: `No vault item found with label or ID: "${label}"`,
            duration: 0,
          };
        }

        if (item.type === 'text') {
          const parts = [
            `🔓 Vault item: "${item.label}"`,
            `Category: ${item.category}`,
            `Value: ${item.value}`,
          ];
          if (item.metadata?.notes) parts.push(`Notes: ${item.metadata.notes}`);
          parts.push(`Stored: ${item.createdAt}`);
          return { toolName: 'vault_retrieve', success: true, result: parts.join('\n'), duration: 0 };
        } else {
          const parts = [
            `📄 Vault document: "${item.label}"`,
            `Category: ${item.category}`,
            `File: ${item.filename} (${item.mimeType})`,
          ];
          if (item.metadata?.notes) parts.push(`Notes: ${item.metadata.notes}`);
          parts.push(`Stored: ${item.createdAt}`);
          parts.push(`\nTo export this document, use it as part of a file operation.`);
          return { toolName: 'vault_retrieve', success: true, result: parts.join('\n'), duration: 0 };
        }
      } catch (err: any) {
        return { toolName: 'vault_retrieve', success: false, error: err.message, duration: 0 };
      }
    });

    // ─── vault_list ──────────────────────────────────────────────────────
    registry.register('vault_list', async (args) => {
      const category = args.category ? String(args.category).toLowerCase() : undefined;
      const searchQuery = args.search ? String(args.search) : undefined;

      try {
        let items = searchQuery ? vault.search(searchQuery) : vault.list(category);

        if (items.length === 0) {
          const msg = category
            ? `No vault items in category "${category}".`
            : searchQuery
              ? `No vault items matching "${searchQuery}".`
              : 'The vault is empty.';
          return { toolName: 'vault_list', success: true, result: msg, duration: 0 };
        }

        const stats = vault.stats();
        const header = `🔐 Vault: ${stats.total} items (${stats.textItems} text, ${stats.documentItems} documents)`;
        const lines = items.map(i => {
          const icon = i.type === 'document' ? '📄' : '🔑';
          const extra = i.filename ? ` — ${i.filename}` : '';
          return `${icon} ${i.label} [${i.category}]${extra}`;
        });

        return {
          toolName: 'vault_list',
          success: true,
          result: `${header}\n\n${lines.join('\n')}`,
          duration: 0,
        };
      } catch (err: any) {
        return { toolName: 'vault_list', success: false, error: err.message, duration: 0 };
      }
    });

    // ─── vault_delete ────────────────────────────────────────────────────
    registry.register('vault_delete', async (args) => {
      const label = String(args.label || '').trim();

      if (!label) {
        return { toolName: 'vault_delete', success: false, error: 'Label or ID is required', duration: 0 };
      }

      try {
        const deleted = vault.delete(label);
        if (!deleted) {
          return {
            toolName: 'vault_delete',
            success: false,
            error: `No vault item found with label or ID: "${label}"`,
            duration: 0,
          };
        }
        return {
          toolName: 'vault_delete',
          success: true,
          result: `🗑️ Deleted vault item: "${label}"`,
          duration: 0,
        };
      } catch (err: any) {
        return { toolName: 'vault_delete', success: false, error: err.message, duration: 0 };
      }
    });
  },
};

export default vaultToolModule;
