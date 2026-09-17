import json

with open("custom/themes/default/nav.json", "r") as f:
    nav = json.load(f)

# Remove from items
items_to_remove = ["commandCenter", "approvals", "webSearch", "cli"]
for key in items_to_remove:
    nav["items"].pop(key, None)

# Remove from layouts
for layout_name, layout in nav["layouts"].items():
    for group in layout.get("groups", []):
        group["items"] = [item for item in group.get("items", []) if item not in items_to_remove]

with open("custom/themes/default/nav.json", "w") as f:
    json.dump(nav, f, indent=2)
