import re

with open("src/api/index.ts", "r") as f:
    content = f.read()

# Remove the import
content = re.sub(r"import\s*{\s*handleCliRoutes\s*}\s*from\s*'\./routes/cli\.js';\n?", "", content)

# Remove the route handler
content = re.sub(r"^\s*if\s*\(\s*await\s*handleCliRoutes\([^)]+\)\)\s*return\s*true;\n?", "", content, flags=re.MULTILINE)

with open("src/api/index.ts", "w") as f:
    f.write(content)
