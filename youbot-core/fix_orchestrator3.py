with open("src/engine/orchestrator.ts", "r") as f:
    content = f.read()

content = content.replace("import { logCapabilityUsage } from '../capabilities/cli/capability-log.js';", "")
content = content.replace("import { runSubAgentTask } from './subagent-runner.js';", "")
content = content.replace("import { createTodoStore } from './todo-store.js';", "")

with open("src/engine/orchestrator.ts", "w") as f:
    f.write(content)
