import re

with open("src/engine/orchestrator.ts", "r") as f:
    content = f.read()

# Remove list_agents
content = re.sub(r'\ttoolRegistry\.register\("list_agents", async \(\) => \{.*?\n\t\}\);\n\n', '', content, flags=re.DOTALL)

# Remove switch_agent
content = re.sub(r'\ttoolRegistry\.register\("switch_agent", async \(args\) => \{.*?\n\t\}\);\n\n', '', content, flags=re.DOTALL)

# Remove delegate_to_agent
content = re.sub(r'\ttoolRegistry\.register\("delegate_to_agent", async \(args, context\) => \{.*?\n\t\}\);\n\n', '', content, flags=re.DOTALL)

# Remove broadcast_message
content = re.sub(r'\ttoolRegistry\.register\("broadcast_message", async \(args, context\) => \{.*?\n\t\}\);\n\n', '', content, flags=re.DOTALL)

# Remove blackboard tools
content = re.sub(r'\ttoolRegistry\.register\("blackboard_write", async \(args, context\) => \{.*?\n\t\}\);\n\n', '', content, flags=re.DOTALL)
content = re.sub(r'\ttoolRegistry\.register\("blackboard_read", async \(args\) => \{.*?\n\t\}\);\n\n', '', content, flags=re.DOTALL)

# Remove execute_plan
content = re.sub(r'\ttoolRegistry\.register\("execute_plan", async \(args, context\) => \{.*?\n\t\}\);\n\n', '', content, flags=re.DOTALL)

# Remove task continuation logic (pendingCount)
content = re.sub(r'\t\t\t\t\tconst todos = null;\n\t\t\t\t\tconst pendingCount = todos\.filter\(.*?\)\.length;\n\n\t\t\t\t\tif \(pendingCount > 0\) \{.*?\}\n', '', content, flags=re.DOTALL)

with open("src/engine/orchestrator.ts", "w") as f:
    f.write(content)

