import re

# Fix api/index.ts
with open("src/api/index.ts", "r") as f:
    content = f.read()
content = re.sub(r"      spawnedSessionStore\.failAllRunningSessions\('Server restarted while sub-agent was running'\);\n", "", content)
content = re.sub(r"    getSpawnedSessionStore: \(\) => spawnedSessionStore,\n", "", content)
with open("src/api/index.ts", "w") as f:
    f.write(content)

# Fix orchestrator.ts
with open("src/engine/orchestrator.ts", "r") as f:
    lines = f.readlines()
with open("src/engine/orchestrator.ts", "w") as f:
    for line in lines:
        if "capability-log.js" in line or "subagent-runner.js" in line or "todo-store.js" in line:
            continue
        f.write(line)

# Fix src/index.ts
with open("src/index.ts", "r") as f:
    lines = f.readlines()
with open("src/index.ts", "w") as f:
    for line in lines:
        if "setSerperApiKey" in line:
            continue
        f.write(line)

