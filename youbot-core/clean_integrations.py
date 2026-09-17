import re

with open("src/api/routes/integrations-providers.ts", "r") as f:
    content = f.read()

content = re.sub(r"async function syncSearchToSerper\(\): Promise<void> \{.*?\n\}\n", "", content, flags=re.DOTALL)
content = re.sub(r"    if \(category === 'search'\) syncSearchToSerper\(\);\n", "", content)

with open("src/api/routes/integrations-providers.ts", "w") as f:
    f.write(content)
