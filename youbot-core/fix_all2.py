import re

# Fix context.ts
with open("src/api/context.ts", "r") as f:
    content = f.read()
content = re.sub(r"  spawnedSessionStore: SpawnedSessionStore \| null;\n", "", content)
with open("src/api/context.ts", "w") as f:
    f.write(content)

# Fix api/index.ts
with open("src/api/index.ts", "r") as f:
    content = f.read()
content = re.sub(r"let spawnedSessionStore: SpawnedSessionStore \| null = null;\n", "", content)
content = re.sub(r"    spawnedSessionStore,\n", "", content)
with open("src/api/index.ts", "w") as f:
    f.write(content)

# Fix orchestrator.ts
with open("src/engine/orchestrator.ts", "r") as f:
    content = f.read()
content = re.sub(r"import \{ logCapabilityUsage \} from '\.\./capabilities/cli/capability-log\.js';\n", "", content)
content = re.sub(r"import \{ runSubAgentTask \} from '\./subagent-runner\.js';\n", "", content)
content = re.sub(r"import \{ createTodoStore \} from '\./todo-store\.js';\n", "", content)
with open("src/engine/orchestrator.ts", "w") as f:
    f.write(content)

# Fix src/index.ts
with open("src/index.ts", "r") as f:
    content = f.read()
content = re.sub(r"import \{ setSerperApiKey \} from '\./capabilities/web-search/adapters/serper\.js';\n", "", content)
with open("src/index.ts", "w") as f:
    f.write(content)

