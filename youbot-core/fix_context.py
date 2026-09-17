import re

with open("src/api/context.ts", "r") as f:
    content = f.read()

content = re.sub(r"import \{ SpawnedSessionStore \} from '\.\./engine/spawned-session-store\.js';\n", "", content)
content = re.sub(r"  spawnedSessionStore\?: SpawnedSessionStore;\n", "", content)

with open("src/api/context.ts", "w") as f:
    f.write(content)
