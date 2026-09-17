import json

with open("config.json", "r") as f:
    config = json.load(f)

# Remove cli and webSearch from defaults
if "defaults" in config:
    config["defaults"].pop("cli", None)
    config["defaults"].pop("search", None)

# Remove cli and webSearch from capabilities
if "capabilities" in config:
    config["capabilities"].pop("cli", None)
    config["capabilities"].pop("search", None)

with open("config.json", "w") as f:
    json.dump(config, f, indent=4)
