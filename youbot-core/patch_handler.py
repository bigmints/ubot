import re

with open('src/engine/handler.ts', 'r') as f:
    content = f.read()

# 1. Update resolveSessionId signature
content = content.replace(
    "function resolveSessionId(msg: UnifiedMessage, isOwner: boolean): string {",
    "function resolveSessionId(msg: UnifiedMessage, isOwner: boolean, universalContactId: string): string {"
)
# Update body
content = re.sub(
    r'  // Visitors get channel-specific sessions\n.*?default:\n      return msg\.senderId;\n  \}',
    r'  // Visitors share a single session across channels based on their Universal ID\n  return universalContactId;',
    content,
    flags=re.DOTALL
)

# 2. Main Handler modifications
handler_start = content.find("export async function handleIncomingMessage(")
handler_body = content[handler_start:]

# Inject universal contact resolution right before logging
resolve_block = """  // 2.5 Resolve Universal Contact ID
  let universalContactId = msg.senderId;
  if (deps.contactStore) {
    try {
      const uContact = await deps.contactStore.resolveContact(msg.channel, msg.senderId, msg.senderName, isOwner ? 'owner' : 'person');
      universalContactId = uContact.id;
    } catch (err: any) {
      console.warn(`[Unified] Failed to resolve universal contact for ${msg.senderId}:`, err.message);
    }
  }

  // 3. Log
"""
content = content.replace("  // 3. Log\n", resolve_block)

# Update resolveSessionId call
content = content.replace(
    "const sessionId = resolveSessionId(msg, isOwner);",
    "const sessionId = resolveSessionId(msg, isOwner, universalContactId);"
)

# Update skill event payload
content = content.replace(
    "        from: msg.senderId,",
    "        from: universalContactId,"
)

# Update promiseTracker call (visitor)
content = re.sub(
    r'          msg\.channel,\n          msg\.senderId,\n        \);',
    r'          msg.channel,\n          universalContactId,\n        );',
    content
)

# Update promiseTracker call (owner)
content = re.sub(
    r'        msg\.channel,\n        msg\.senderId,\n      \);',
    r'        msg.channel,\n        universalContactId,\n      );',
    content
)


with open('src/engine/handler.ts', 'w') as f:
    f.write(content)

