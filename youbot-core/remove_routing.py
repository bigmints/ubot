import re

with open("web-ui/app/llms/page.tsx", "r") as f:
    content = f.read()

# Remove the routing JSX block
routing_start = content.find("{/* ─── Section 2: Model Routing ─────────────────────────── */}")
usage_start = content.find("{/* ─── Section 3: Usage Metering ─────────────────────── */}")

if routing_start != -1 and usage_start != -1:
    content = content[:routing_start] + content[usage_start:]

with open("web-ui/app/llms/page.tsx", "w") as f:
    f.write(content)
