import re

with open("src/engine/tools.ts", "r") as f:
    content = f.read()

# remove list_agents
content = re.sub(r"  \{\n    name: 'list_agents',.*?  \},\n", "", content, flags=re.DOTALL)
# remove switch_agent
content = re.sub(r"  \{\n    name: 'switch_agent',.*?  \},\n", "", content, flags=re.DOTALL)
# remove delegate_to_agent
content = re.sub(r"  \{\n    name: 'delegate_to_agent',.*?  \},\n", "", content, flags=re.DOTALL)
# remove broadcast_message
content = re.sub(r"  \{\n    name: 'broadcast_message',.*?  \},\n", "", content, flags=re.DOTALL)

with open("src/engine/tools.ts", "w") as f:
    f.write(content)
