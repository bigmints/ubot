import re

with open("src/tools/types.ts", "r") as f:
    content = f.read()

content = re.sub(r"  getSpawnedSessionStore: \(\) => .*?;\n", "", content)

with open("src/tools/types.ts", "w") as f:
    f.write(content)

