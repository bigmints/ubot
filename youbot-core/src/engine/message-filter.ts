/**
 * Message Filter
 * 
 * Logic for pre-processing conversation history before injection into LLM context.
 */

export interface AgentMessage {
  role: string;
  content: string;
  timestamp?: Date;
}

/**
 * Filter out stale tool failure messages from the conversation history.
 * 
 * Prevents "memory poisoning" where past transient errors continue to 
 * influence the LLM's future tool choice logic.
 * 
 * @param messages Array of messages from history
 * @param maxAgeMs Maximum age for a tool failure message to be kept (default 1 hour)
 * @returns Filtered messages
 */
export function filterStaleErrors<T extends AgentMessage>(
  messages: T[],
  maxAgeMs: number = 3600000
): T[] {
  const now = Date.now();
  
  return messages.filter(msg => {
    // Keep all non-tool messages
    if (msg.role !== 'tool' && msg.role !== 'assistant') return true;
    
    // Assistant messages that contain "TOOL FAILED" (if they are direct responses to errors)
    // or Tool messages that actually contain the error evidence.
    const isError = msg.content.includes('TOOL FAILED') || msg.content.includes('Error:');
    
    if (isError) {
      if (!msg.timestamp) return true; // Keep if we don't know the age
      
      const age = now - msg.timestamp.getTime();
      const isStale = age > maxAgeMs;
      
      if (isStale) {
        // console.log(`[MessageFilter] Dropping stale error message (${Math.floor(age/1000/60)}m old)`);
        return false;
      }
    }
    
    return true;
  });
}
