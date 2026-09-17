import re

with open("src/tools/registry.ts", "r") as f:
    content = f.read()

content = re.sub(r'import sessionsTools from "\.\./engine/session-tools\.js";\n', '', content)
content = re.sub(r'import todoToolModule from "\.\./engine/todo-tools\.js";\n', '', content)

content = re.sub(r'  sessionsTools,\n', '', content)
content = re.sub(r'  todoToolModule,\n', '', content)

with open("src/tools/registry.ts", "w") as f:
    f.write(content)
