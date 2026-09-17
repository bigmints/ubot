import re

# Fix src/tools/types.ts
with open("src/tools/types.ts", "r") as f:
    content = f.read()
content = re.sub(r"  getSpawnedSessionStore: \(\) => any; // SpawnedSessionStore\n", "", content)
content = re.sub(r"  getSpawnedSessionStore: \(\) => any;\n", "", content)
with open("src/tools/types.ts", "w") as f:
    f.write(content)

# Fix src/engine/orchestrator.ts
with open("src/engine/orchestrator.ts", "r") as f:
    content = f.read()
# Let's just remove the lines calling runSubagent and getTodos.
content = re.sub(r"await runSubagent\(.*?\);", "null;", content, flags=re.DOTALL)
content = re.sub(r"await getTodos\(.*?\);", "null;", content, flags=re.DOTALL)
content = content.replace("runSubagent", "/* removed runSubagent */ null")
content = content.replace("getTodos", "/* removed getTodos */ null")
with open("src/engine/orchestrator.ts", "w") as f:
    f.write(content)

