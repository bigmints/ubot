import json
import os

if os.path.exists("config.json"):
    with open("config.json", "r") as f:
        cfg = json.load(f)

    if "defaults" in cfg:
        del cfg["defaults"]
    
    with open("config.json", "w") as f:
        json.dump(cfg, f, indent=2)
