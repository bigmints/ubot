/**
 * Soul Module
 * Ubot's identity, personality, and evolving knowledge about its owner and contacts.
 * 
 * Three soul layers stored as YAML documents:
 * 1. Bot Soul   — Ubot's own persona (tone, style, personality traits)
 * 2. Owner Soul — Deep profile of the owner (you) — preferences, habits, context
 * 3. Contact Souls — Profiles for each person the owner interacts with
 */

import { documentRevision } from '../concierge/owner-profile.js';
import type { MemoryStore } from './memory-store.js';
import type { WorkspaceProvider } from '../data/workspace-provider.js';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Special persona IDs for bot and owner souls */
export const BOT_SOUL_ID = '__bot__';
export const OWNER_SOUL_ID = '__owner__';

/** File mapping for special personas */
const SOUL_FILE_MAP: Record<string, string> = {
  [BOT_SOUL_ID]: 'IDENTITY.md',
  [OWNER_SOUL_ID]: 'SOUL.md',
};

/* ------------------------------------------------------------------ */
/*  Default bot persona (YAML seed)                                    */
/* ------------------------------------------------------------------ */

const DEFAULT_BOT_SOUL = `# Bot Persona
name: Ubot
role: Personal AI assistant
purpose: Help the owner manage their communications and automate tasks

# Personality
tone: Warm, conversational, and helpful
style: Concise but friendly. Uses emoji occasionally. Adapts to the conversation.
boundaries: Always acts on behalf of the owner. Never reveals it is an AI unless asked directly.
`;

const DEFAULT_OWNER_SOUL = `# Owner Profile
# This document is automatically updated as the bot learns about you from conversations.
# You can also edit it manually.
`;

/* ------------------------------------------------------------------ */
/*  Soul interface                                                     */
/* ------------------------------------------------------------------ */

export interface Soul {
  /** Get the raw YAML document for a persona */
  getDocument(personaId: string): Promise<string>;

  /** Save a YAML document for a persona */
  saveDocument(personaId: string, content: string, expectedRevision?: string): Promise<void>;

  /** Delete a persona document */
  deleteDocument(personaId: string): Promise<boolean>;

  /** List all persona IDs with metadata */
  listPersonas(): Promise<Array<{ id: string; label: string; updatedAt: Date; contentLength: number }>>;

  /** Build a comprehensive system prompt section from all soul documents */
  buildSoulPrompt(contactId?: string, isOwner?: boolean): Promise<string>;

  /** Sync documents from SQLite to filesystem if they don't exist */
  syncToFilesystem(): Promise<void>;

  /** Get the raw memory store for direct access */
  getStore(): MemoryStore;
}

/* ------------------------------------------------------------------ */
/*  Implementation                                                     */
/* ------------------------------------------------------------------ */

export function createSoul(memoryStore: MemoryStore, workspacePath?: string, workspace?: WorkspaceProvider): Soul {
  // File cache to avoid frequent reads
  const fileCache: Record<string, string> = {};
  const documentWrites = new Map<string, Promise<void>>();

  /** Get workspace-relative path for a persona file, or null if not a mapped persona */
  const getRelativePath = (personaId: string): string | null => {
    const filename = SOUL_FILE_MAP[personaId];
    if (!filename) return null;
    return filename; // e.g. 'IDENTITY.md', 'SOUL.md' — relative to workspace root
  };

  const loadFile = (personaId: string): string | null => {
    if (!workspace) return null;
    const relPath = getRelativePath(personaId);
    if (!relPath) return null;
    try {
      const content = workspace.readFile(relPath);
      if (content) {
        fileCache[personaId] = content;
        return content;
      }
      return null;
    } catch (err) {
      console.error(`[Soul] Error reading ${relPath}:`, err);
      return null;
    }
  };

  // Setup file watching (only works for local workspace providers)
  if (workspace?.watch) {
    Object.entries(SOUL_FILE_MAP).forEach(([personaId, filename]) => {
      if (workspace.exists(filename)) {
        workspace.watch!(filename, (event) => {
          if (event === 'change') {
            console.log(`[Soul] 🔄 Reloading ${filename} due to external change`);
            loadFile(personaId);
          }
        });
      }
    });
  }

  // Seed default documents if not already present in memoryStore
  memoryStore.getDocument(BOT_SOUL_ID).then(existingBot => {
    if (!existingBot) {
      memoryStore.saveDocument(BOT_SOUL_ID, DEFAULT_BOT_SOUL).catch(err => {
        console.warn(`[Soul] ⚠️ Failed to seed bot document to DB: ${err.message}`);
      });
      console.log('[Soul] 🧠 Seeded default bot persona document');
    }
  }).catch(() => {});

  memoryStore.getDocument(OWNER_SOUL_ID).then(existingOwner => {
    if (!existingOwner) {
      memoryStore.saveDocument(OWNER_SOUL_ID, DEFAULT_OWNER_SOUL).catch(err => {
        console.warn(`[Soul] ⚠️ Failed to seed owner document to DB: ${err.message}`);
      });
      console.log('[Soul] 🧠 Seeded default owner profile document');
    }
  }).catch(() => {});

  return {
    async getDocument(personaId: string): Promise<string> {
      // Prioritize file-based identity if matched and exists
      const fileContent = loadFile(personaId);
      if (fileContent) return fileContent;

      const doc = await memoryStore.getDocument(personaId);
      return doc?.content || '';
    },

    async saveDocument(personaId: string, content: string, expectedRevision?: string): Promise<void> {
      const previous = documentWrites.get(personaId) || Promise.resolve();
      const write = previous.catch(() => {}).then(async () => {
        const previousDocument = loadFile(personaId) ?? (await memoryStore.getDocument(personaId))?.content ?? '';
        if (expectedRevision !== undefined && documentRevision(previousDocument) !== expectedRevision) {
          const error = new Error('This profile changed since you opened it. Reload the saved version before saving.');
          error.name = 'ProfileConflict'; throw error;
        }
        await memoryStore.saveDocument(personaId, content);
        const relPath = getRelativePath(personaId);
        if (workspace && relPath) {
          try { workspace.writeFile(relPath, content); fileCache[personaId] = content; }
          catch(error) { await memoryStore.saveDocument(personaId, previousDocument); throw error; }
        }
        const persisted = await memoryStore.getDocument(personaId);
        if (persisted?.content !== content || (workspace && relPath && workspace.readFile(relPath) !== content)) throw new Error('The profile could not be saved consistently. Reload and try again.');
      });
      documentWrites.set(personaId, write);
      try { await write; } finally { if (documentWrites.get(personaId) === write) documentWrites.delete(personaId); }
    },

    async deleteDocument(personaId: string): Promise<boolean> {
      return await memoryStore.deleteDocument(personaId);
    },

    async listPersonas(): Promise<Array<{ id: string; label: string; updatedAt: Date; contentLength: number }>> {
      const docs = await memoryStore.listDocuments();
      return docs.map((d: any) => {
        let label = d.personaId;
        if (d.personaId === BOT_SOUL_ID) {
          label = 'Bot Persona';
        } else if (d.personaId === OWNER_SOUL_ID) {
          label = 'Owner Profile';
        } else {
          // Try to extract name from the document content
          const nameMatch = d.content.match(/name:\s*(.+)/i);
          if (nameMatch && nameMatch[1].trim()) {
            label = nameMatch[1].trim();
          } else if (d.personaId.endsWith('@lid')) {
            // LID-based contact — don't format as phone number
            label = 'WhatsApp Contact (' + d.personaId.replace(/@.*/, '').slice(-6) + ')';
          } else if (d.personaId.includes('@')) {
            // Format JID as readable: "971569737344@s.whatsapp.net" → "+971569737344"
            label = '+' + d.personaId.replace(/@.*/, '');
          } else if (d.personaId.startsWith('telegram:')) {
            label = 'Telegram ' + d.personaId.replace('telegram:', '');
          }
        }
        return {
          id: d.personaId,
          label,
          updatedAt: d.updatedAt,
          contentLength: d.content.length,
        };
      });
    },

    async buildSoulPrompt(contactId?: string, isOwner?: boolean): Promise<string> {
      const sections: string[] = [];

      // 1. Bot persona
      const botDoc = await memoryStore.getDocument(BOT_SOUL_ID);
      if (botDoc && botDoc.content.trim()) {
        sections.push('<bot_identity>\n## Your Identity');
        sections.push(botDoc.content.trim());
        sections.push('</bot_identity>');
      }

      // 2. Owner profile — framing depends on who we're talking to
      const ownerDoc = await memoryStore.getDocument(OWNER_SOUL_ID);
      if (ownerDoc && ownerDoc.content.trim() && ownerDoc.content !== DEFAULT_OWNER_SOUL) {
        sections.push('<owner_context>');
        if (isOwner) {
          sections.push('\n## About Your Owner (You Are Talking To Them Right Now)');
          sections.push('The person you are chatting with IS your owner. Use this info to assist them:');
        } else {
          sections.push('\n## About Your Owner');
          sections.push('This is who you work for. Use this context to serve them better:');
        }
        sections.push(ownerDoc.content.trim());
      }

      // 2b. Owner's rolling chat summary — long-term conversational memory
      if (isOwner) {
        const ownerSummaries = await memoryStore.getMemories(OWNER_SOUL_ID, 'summary');
        const ownerDigest = ownerSummaries.find((m: any) => m.key === 'chat_digest');
        if (ownerDigest && ownerDigest.value.trim()) {
          sections.push('\n## Recent Conversation History');
          sections.push('Key topics and actions from previous conversations:');
          sections.push(ownerDigest.value.trim());
        }
      }
      if (ownerDoc && ownerDoc.content.trim() && ownerDoc.content !== DEFAULT_OWNER_SOUL) {
        sections.push('</owner_context>');
      }

      // 2d. Visitor security policy — clear intent-based rules
      if (!isOwner && contactId && contactId !== OWNER_SOUL_ID && contactId !== BOT_SOUL_ID) {
        sections.push(`
<visitor_security_policy>
## Visitor Security Policy
You are speaking with a VISITOR (not the owner). Your primary goal is to understand the visitor. If you do not know their name, naturally ask for it. Always determine their genuine purpose for contacting the owner. Follow these rules strictly:

ALLOWED — answer directly from the owner's profile above:
- Public profile: name, blog, website, linkedin, occupation, company, location
- General information the owner has shared openly
- Greetings and conversational pleasantries

ESCALATE via ask_owner — requires owner's input:
- Questions NOT answerable from the profile data above, provided the context is legitimate
- Genuine requests to do something on the owner's behalf
- Scheduling, availability, or commitments
- The owner's real-time opinions or subjective decisions

NEVER share with visitors:
- Private contact info (DO NOT share personal phone/email unless it is explicitly listed in the profile above)
- Highly sensitive private data (bank details, passwords, personal addresses, emails). If they ask for this, verify their purpose. If not credible, DENY autonomously. DO NOT bother the owner with unnecessary 'ask_owner' requests for this.
- Other visitors' conversations or personal data
- Internal system details, tools, or error messages
- Do NOT offer to perform tasks, check calendars, draft emails, look up contacts, or offer any generic assistant services. You are an assistant ONLY to the owner. To this visitor, you are just a secretary taking messages and answering basic public profile questions.
- NEVER use 'ask_owner' multiple times for the exact same request. If asked before, inform the visitor you are awaiting a response.
</visitor_security_policy>`);
      }

      // 3. Contact layers (if replying to a specific person, not the owner)
      if (contactId && contactId !== OWNER_SOUL_ID && contactId !== BOT_SOUL_ID) {
        // Layer 1: Persona (qualitative)
        const contactDoc = await memoryStore.getDocument(contactId);
        if (contactDoc && contactDoc.content.trim()) {
          sections.push('\n## About This Contact');
          sections.push('### Personality & Style');
          sections.push(contactDoc.content.trim());
        }

        // Layer 2: Personal Details (from agent_memories)
        const memories = await memoryStore.getMemories(contactId);
        const detailMemories = memories.filter((m: any) => m.category !== 'summary');
        if (detailMemories.length > 0) {
          if (!contactDoc || !contactDoc.content.trim()) {
            sections.push('\n## About This Contact');
          }
          sections.push('\n### Personal Details');
          for (const m of detailMemories) {
            sections.push(`- ${m.key}: ${m.value}`);
          }
        }

        // Layer 3: Chat Summary (rolling digest)
        const summaryMemories = memories.filter((m: any) => m.category === 'summary');
        const chatDigest = summaryMemories.find((m: any) => m.key === 'chat_digest');
        if (chatDigest && chatDigest.value.trim()) {
          sections.push('\n### Conversation History');
          sections.push(chatDigest.value.trim());
        }

        if (contactDoc?.content.trim() || detailMemories.length > 0 || chatDigest) {
          sections.push('\nUse this context naturally. Do not explicitly say "I remember you said..."');
        }
      }

      return sections.join('\n');
    },

    async syncToFilesystem(): Promise<void> {
      if (!workspace) return;
      
      for (const personaId of Object.keys(SOUL_FILE_MAP)) {
        const relPath = getRelativePath(personaId);
        if (relPath && !workspace.exists(relPath)) {
          console.log(`[Soul] 📂 Exporting ${personaId} to ${relPath}`);
          const content = await this.getDocument(personaId);
          if (content) {
            workspace.writeFile(relPath, content);
          }
        }
      }
    },

    getStore(): MemoryStore {
      return memoryStore;
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Soul document rewrite prompt                                       */
/* ------------------------------------------------------------------ */

export const SOUL_REWRITE_PROMPT = `You are a persona manager for an AI assistant called Ubot.
Your job is to maintain a PERSONALITY PROFILE about a person — who they are qualitatively.

You will be given:
1. The CURRENT persona document (may be empty for new contacts)
2. METADATA about the contact (channel, name)
3. A new CONVERSATION snippet

Your task:
- Update the persona with personality and relationship insights from the conversation
- Focus on WHO they are, not WHAT they discussed
- Keep it concise, well-organized, and in YAML-like format
- Preserve existing traits unless clearly outdated/corrected
- If nothing new about their personality was revealed, return the document unchanged

Format the document with these sections:
# Personality
tone: [how they communicate — formal, casual, brief, verbose, etc.]
language: [preferred language if apparent]
style: [any notable communication patterns]

# Relationship
role: [their relation to the owner — friend, client, colleague, family, unknown]
context: [brief description of who they are and how they relate to the owner]

# Traits
[Key personality traits, interests, or notable characteristics observed from conversations]

# Preferences
[Any stated preferences — communication channel, timing, topics they care about]

Rules:
- This is a PERSONALITY profile, NOT a conversation log
- Do NOT include what they asked about or discussed (that goes in chat summary)
- Do NOT include contact details like phone, email, etc. (that goes in personal details)
- Be conservative — only add traits explicitly demonstrated or strongly implied
- Keep the document under 1000 characters
- Respond with ONLY the updated document, nothing else
- Do NOT add information that was not in the conversation`;

/* ------------------------------------------------------------------ */
/*  Owner merge prompt — append-only, never replaces existing content  */
/* ------------------------------------------------------------------ */

export const OWNER_MERGE_PROMPT = `You are a persona manager for an AI assistant.
Your job is to extract ONLY NEW personality/preference facts about the owner from a conversation.

You will be given:
1. The CURRENT owner profile document
2. A new CONVERSATION snippet (between the owner and the bot)

Your task:
- Compare the conversation against the existing document
- Extract ONLY personality, preference, or trait facts NOT already in the document
- If nothing new was learned, respond with exactly: NO_NEW_FACTS
- If there are new facts, respond with a short block in this format:

## New Facts
- [section]: [fact]
- [section]: [fact]

Where [section] is one of: Personality, Preferences, Traits

Example output:
## New Facts
- Preferences: Prefers morning meetings before 10am
- Traits: Entrepreneurial mindset

Rules:
- NEVER repeat facts already in the existing document
- Focus on WHO the owner is (personality, values, style), not WHAT they have
- Do NOT log conversation topics or questions asked
- Keep each fact to one concise line
- Respond with NO_NEW_FACTS if nothing new about their personality was revealed
- Do NOT include greetings, small talk, or bot responses as facts
- NEVER include: URLs, websites, blogs, email addresses, phone numbers, physical addresses, social media links, job titles, company names, or any other structured/quantitative data — those are stored separately in the profile layer`;

/**
 * Merge new facts into an existing owner document.
 * Appends a timestamped section at the end, preserving all existing content.
 */
export function mergeIntoOwnerDoc(existingDoc: string, newFacts: string): string {
  // If LLM says nothing new, return unchanged
  if (!newFacts || newFacts.trim() === 'NO_NEW_FACTS') {
    return existingDoc;
  }

  // Parse the new facts into section → facts map
  const factLines = newFacts.split('\n').filter(l => l.trim().startsWith('- '));
  if (factLines.length === 0) return existingDoc;

  // Group facts by section
  const sectionMap: Record<string, string[]> = {};
  for (const line of factLines) {
    const match = line.match(/^-\s*(\w[\w\s]*?):\s*(.+)/);
    if (match) {
      const section = match[1].trim();
      const fact = match[2].trim();
      if (!sectionMap[section]) sectionMap[section] = [];
      sectionMap[section].push(fact);
    }
  }

  if (Object.keys(sectionMap).length === 0) return existingDoc;

  // Append facts into the existing doc under the right sections
  let doc = existingDoc.trimEnd();
  
  for (const [section, facts] of Object.entries(sectionMap)) {
    const sectionHeader = `# ${section}`;
    const sectionIndex = doc.indexOf(sectionHeader);
    
    if (sectionIndex !== -1) {
      // Find the end of this section (next # header or end of doc)
      const afterHeader = sectionIndex + sectionHeader.length;
      const nextSection = doc.indexOf('\n# ', afterHeader);
      const insertPos = nextSection !== -1 ? nextSection : doc.length;
      
      // Append facts before the next section
      const factsText = '\n' + facts.join('\n');
      doc = doc.slice(0, insertPos) + factsText + doc.slice(insertPos);
    } else {
      // Section doesn't exist — add it at the end
      doc += `\n\n${sectionHeader}\n${facts.join('\n')}`;
    }
  }

  return doc;
}

/* ------------------------------------------------------------------ */
/*  Fact extraction prompt — structured personal details as JSON       */
/* ------------------------------------------------------------------ */

export const FACT_EXTRACTION_PROMPT = `Extract structured personal details from this conversation.
Return a JSON object with key-value pairs of facts learned about the USER (not the assistant).

Only include facts that are explicitly stated or very strongly implied.
If no new facts are found, return an empty object: {}

Use these standard keys when applicable:
- name: their full name or display name
- occupation: job title or profession
- company: where they work
- location: city or country
- email: email address
- language: preferred language
- timezone: their timezone if mentioned

You may also use custom keys for other facts (e.g. "birthday", "spouse_name").

Rules:
- Return ONLY valid JSON, nothing else
- Do NOT include conversation topics or what they asked about
- Do NOT include contact channel info (phone, telegram) — that's handled separately
- Keep values concise (single line)`;

/* ------------------------------------------------------------------ */
/*  Chat summary prompt — rolling conversation digest                  */
/* ------------------------------------------------------------------ */

export const SUMMARY_UPDATE_PROMPT = `You maintain a rolling summary of conversations between a person and an AI assistant.

You will be given:
1. The CURRENT summary (may be empty for first conversation)
2. A new CONVERSATION snippet (may include tool actions taken)

Your task:
- Update the summary to include key points from the new conversation
- Keep it as a concise digest of all past interactions
- Focus on: what was discussed, what was SUCCESSFULLY accomplished, what was decided/resolved
- Include specific details like file paths, names, numbers, and results when relevant
- Drop trivial details (greetings, small talk)
- Keep the summary under 2000 characters
- Most recent topics should appear first
- Use a structured format: group related items, use dashes for lists

CRITICAL RULES:
- NEVER record tool errors, failures, timeouts, or technical issues in the summary
- NEVER write that the AI "cannot" or "failed to" do something — these are transient states, not facts
- ONLY include successfully completed actions and their outcomes
- If a task was attempted but failed, omit it entirely — do not note the failure

If the current summary is empty, create a new one from the conversation.
Respond with ONLY the updated summary text, nothing else.`;
