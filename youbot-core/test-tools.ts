import { getToolsForSource } from './src/engine/tools.js';
import { loadAgentDefinitions } from './src/engine/agent-loader.js';
import path from 'path';

async function test() {
  const allTools = await getToolsForSource(true);
  const agents = loadAgentDefinitions(path.join(process.cwd(), 'workspace'));
  const nexus = agents.find(a => a.id === 'nexus');
  if (!nexus) {
    console.log("nexus not found");
    return;
  }
  const filteredTools = allTools.filter(t => nexus.allowedTools!.includes(t.name));
  console.log(`Total tools: ${allTools.length}`);
  console.log(`Nexus allowedTools array length: ${nexus.allowedTools!.length}`);
  console.log(`Filtered tools length: ${filteredTools.length}`);
  console.log(`Filtered tools:`, filteredTools.map(t => t.name));
}
test().catch(console.error);
