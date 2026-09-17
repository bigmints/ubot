import re

with open("src/api/index.ts", "r") as f:
    content = f.read()

content = re.sub(r"      if \(cfg\.defaults\) \{.*?        \}\n      \}\n", "", content, flags=re.DOTALL)

with open("src/api/index.ts", "w") as f:
    f.write(content)
