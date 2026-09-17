with open("custom/AGENTS.md", "r") as f:
    lines = f.readlines()

new_lines = []
skip = False
for line in lines:
    if "└── xtara/" in line:
        continue
    if "## Real-World Example: Xtara" in line:
        skip = True
    
    if not skip:
        # replace xtara mentions in the middle of sentences if needed
        line = line.replace("'my-app', 'xtara'", "'my-app'")
        line = line.replace("myapp_, xtara_, etc", "myapp_, etc")
        new_lines.append(line)

with open("custom/AGENTS.md", "w") as f:
    f.writelines(new_lines)
