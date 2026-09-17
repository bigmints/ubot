import re

# Fix context.ts
with open("src/api/context.ts", "r") as f:
    content = f.read()
content = re.sub(r"import type \{.*?SpawnedSessionStore.*?\} from '\.\./engine/spawned-session-store\.js';\n", "", content)
content = re.sub(r"  spawnedSessionStore\?: any;\n", "", content)
content = re.sub(r"  spawnedSessionStore\?: SpawnedSessionStore;\n", "", content)
with open("src/api/context.ts", "w") as f:
    f.write(content)

# Fix api/index.ts
with open("src/api/index.ts", "r") as f:
    content = f.read()
content = re.sub(r"let spawnedSessionStore: any;\n", "", content)
content = re.sub(r"let spawnedSessionStore: SpawnedSessionStore;\n", "", content)
with open("src/api/index.ts", "w") as f:
    f.write(content)

# Fix integrations.ts (Google)
with open("src/api/routes/integrations.ts", "r") as f:
    content = f.read()
content = re.sub(r"  if \(url === '/api/google/auth/status'.*?\} catch \(err: any\) \{\n      error\(res, err\.message, 500\);\n    \}\n", "", content, flags=re.DOTALL)
content = re.sub(r"  if \(url === '/api/google/services/config'.*?\}\n", "", content, flags=re.DOTALL)
content = re.sub(r"  if \(url === '/api/google/.*?\}\n    return true;\n  \}\n\n", "", content, flags=re.DOTALL)
with open("src/api/routes/integrations.ts", "w") as f:
    f.write(content)

# Fix modules.ts
with open("src/api/routes/modules.ts", "r") as f:
    content = f.read()
content = content.replace("../../capabilities/cli/custom-loader.js", "../../tools/custom-loader.js")
content = content.replace("m => {", "(m: any) => {")
with open("src/api/routes/modules.ts", "w") as f:
    f.write(content)

# Fix orchestrator.ts
with open("src/engine/orchestrator.ts", "r") as f:
    content = f.read()
content = re.sub(r"import \{ logCapabilityUsage \} from '\.\./capabilities/cli/capability-log\.js';\n", "", content)
content = re.sub(r"import \{ runSubAgentTask \} from '\./subagent-runner\.js';\n", "", content)
content = re.sub(r"import \{ createTodoStore \} from '\./todo-store\.js';\n", "", content)
content = re.sub(r"      logCapabilityUsage\(\{.*?\n      \}\);\n", "", content, flags=re.DOTALL)
content = re.sub(r"  // Initialize sub-components\n  const todoStore = createTodoStore\(db\);\n", "  // Sub-components initialized here if any\n", content)
content = re.sub(r"          await runSubAgentTask\(\{.*?\n          \}\);\n", "          // Deprecated: runSubAgentTask()\n", content, flags=re.DOTALL)
with open("src/engine/orchestrator.ts", "w") as f:
    f.write(content)

# Fix src/index.ts
with open("src/index.ts", "r") as f:
    content = f.read()
content = re.sub(r"      try \{\n        const \{ setSerperApiKey \} = await import\('\./capabilities/web-search/adapters/serper\.js'\);\n        setSerperApiKey\(config\.capabilities\.search\.providers\.serper\.apiKey as string\);\n      \} catch \{ /\* ignore \*/ \}\n", "", content)
with open("src/index.ts", "w") as f:
    f.write(content)

# Fix custom-loader.ts
with open("src/tools/custom-loader.ts", "r") as f:
    content = f.read()
content = content.replace("../../tools/types.js", "./types.js")
content = content.replace("../../logger/ring-buffer.js", "../logger/ring-buffer.js")
content = content.replace("t => t.name", "(t: any) => t.name")
with open("src/tools/custom-loader.ts", "w") as f:
    f.write(content)

