with open("src/engine/orchestrator.ts", "r") as f:
    content = f.read()

# Prepend the dummy functions
header = """
// --- DUMMY IMPLEMENTATIONS FOR REMOVED FEATURES ---
const runSubagent = async (...args: any[]): Promise<any> => ({ status: 'completed', result: 'Subagents are disabled.' });
const getTodos = async (...args: any[]): Promise<any[]> => [];
// --------------------------------------------------

"""
content = header + content

# Also remove the imports for capability-log, subagent-runner, todo-store which still might be there
content = content.replace("import { logCapabilityUsage } from '../capabilities/cli/capability-log.js';", "")
content = content.replace("import { runSubAgentTask } from './subagent-runner.js';", "")
content = content.replace("import { createTodoStore } from './todo-store.js';", "")

with open("src/engine/orchestrator.ts", "w") as f:
    f.write(content)
