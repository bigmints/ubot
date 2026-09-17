import re

with open("src/api/index.ts", "r") as f:
    content = f.read()

# Remove import
content = re.sub(r"import \{ createSpawnedSessionStore, type SpawnedSessionStore \} from '\.\./engine/spawned-session-store\.js';\n", "", content)

# Remove local var
content = re.sub(r"let spawnedSessionStore: SpawnedSessionStore;\n", "", content)

# Remove init
content = re.sub(r"  spawnedSessionStore = createSpawnedSessionStore\(coreDb\);\n", "", content)

# Remove from API context
content = re.sub(r"    spawnedSessionStore,\n", "", content)

# Remove capability-log init
content = re.sub(r"  // Initialize capability audit log\n  if \(coreDb\) \{\n    const \{ initCapabilityLog \} = await import\('\.\./capabilities/cli/capability-log\.js'\);\n    initCapabilityLog\(coreDb\);\n  \}\n", "", content)

# Remove serper logic
content = re.sub(r"      try \{\n        const \{ setSerperApiKey \} = await import\('\.\./capabilities/web-search/adapters/serper\.js'\);\n        setSerperApiKey\(body\.serper_api_key\);\n      \} catch \{ /\* ignore \*/ \}\n", "", content)

with open("src/api/index.ts", "w") as f:
    f.write(content)
