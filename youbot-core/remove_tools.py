import re

with open("src/engine/tools.ts", "r") as f:
    content = f.read()

# Remove execute_plan
content = re.sub(r"  \{\n    name: 'execute_plan'.*?  \},\n", "", content, flags=re.DOTALL)
# Remove blackboard_write
content = re.sub(r"  \{\n    name: 'blackboard_write'.*?  \},\n", "", content, flags=re.DOTALL)
# Remove blackboard_read
content = re.sub(r"  \{\n    name: 'blackboard_read'.*?  \},\n", "", content, flags=re.DOTALL)

with open("src/engine/tools.ts", "w") as f:
    f.write(content)

with open("src/capabilities/filesystem/index.ts", "r") as f:
    fs_content = f.read()

fs_content = fs_content.replace("import patchTools from './patch-tools.js';\n", "")
fs_content = fs_content.replace("  patchTools,\n", "")

with open("src/capabilities/filesystem/index.ts", "w") as f:
    f.write(fs_content)
