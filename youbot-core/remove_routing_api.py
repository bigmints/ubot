import re

with open("src/api/index.ts", "r") as f:
    content = f.read()

# Remove /api/config/defaults GET and PUT
content = re.sub(r"  if \(url === '/api/config/defaults' && method === 'GET'\) \{.*?\n  \}\n", "", content, flags=re.DOTALL)
content = re.sub(r"  if \(url === '/api/config/defaults' && method === 'PUT'\) \{.*?\n  \}\n", "", content, flags=re.DOTALL)

# Remove /api/config/model-routing GET and PUT
content = re.sub(r"  if \(url === '/api/config/model-routing' && method === 'GET'\) \{.*?\n  \}\n", "", content, flags=re.DOTALL)
content = re.sub(r"  if \(url === '/api/config/model-routing' && method === 'PUT'\) \{.*?\n  \}\n", "", content, flags=re.DOTALL)

with open("src/api/index.ts", "w") as f:
    f.write(content)
