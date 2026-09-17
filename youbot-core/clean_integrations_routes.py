import re

with open("src/api/routes/integrations.ts", "r") as f:
    content = f.read()

content = re.sub(r"  // ── Google Auth API ──────────────────────────────────\n.*?    return true;\n  \}\n", "", content, flags=re.DOTALL)

with open("src/api/routes/integrations.ts", "w") as f:
    f.write(content)
