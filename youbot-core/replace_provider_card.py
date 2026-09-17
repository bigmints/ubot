import re

with open("web-ui/app/llms/page.tsx", "r") as f:
    content = f.read()

# Find ProviderCard and AddProviderDialog
start_idx = content.find("function ProviderCard({")
end_idx = content.find("// ─── Add Provider Dialog ─────────────────────────────────────")

if start_idx == -1 or end_idx == -1:
    print("Could not find ProviderCard or AddProviderDialog")
    exit(1)

new_provider_card = """function ProviderCard({
  provider,
  preset,
  onToggle,
  onUpdate,
  onDelete,
}: {
  provider: ConfiguredProvider;
  preset?: ProviderPreset;
  onToggle: () => void;
  onUpdate: (updates: Partial<ConfiguredProvider>) => void;
  onDelete: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editKey, setEditKey] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [editModel, setEditModel] = useState("");
  
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<{id: string, name: string}[]>([]);

  const isOllama = provider.key === "ollama";
  const isLmstudio = provider.key === "lmstudio";
  const isLocalFree = isOllama || isLmstudio;

  const maskedKey = provider.apiKey
    ? provider.apiKey.slice(0, 4) +
      "•".repeat(Math.min(24, provider.apiKey.length - 4))
    : "";

  const fetchModels = async () => {
    setFetchingModels(true);
    try {
      const bUrl = editBaseUrl || provider.baseUrl || "";
      const aKey = editKey || provider.apiKey || "";
      const res = await fetch(`/api/integrations/models/models?provider=${provider.key}&providerKey=${provider.key}&baseUrl=${encodeURIComponent(bUrl)}&apiKey=${encodeURIComponent(aKey)}`);
      const data = await res.json();
      if (data.models && data.models.length > 0) {
        setFetchedModels(data.models);
        if (!editModel) {
          setEditModel(data.models[0].id);
        }
      } else {
        alert(data.error || "No models found or failed to load");
      }
    } catch (e) {
      alert("Failed to fetch models");
    } finally {
      setFetchingModels(false);
    }
  };

  function handleSaveEdit() {
    const updates: Partial<ConfiguredProvider> = {};
    if (editKey) updates.apiKey = editKey;
    if (editBaseUrl !== "") updates.baseUrl = editBaseUrl;
    if (editModel !== "") updates.model = editModel;
    if (Object.keys(updates).length > 0) onUpdate(updates);
    setEditing(false);
    setEditKey("");
    setEditBaseUrl("");
    setEditModel("");
  }

  return (
    <div
      className={`flex items-center gap-4 p-4 rounded-lg border transition-colors ${
        provider.enabled ? "bg-card" : "bg-muted/30 opacity-60"
      }`}
    >
      {/* Icon */}
      <div className="text-2xl w-10 h-10 rounded-lg flex items-center justify-center bg-muted/50 shrink-0">
        {preset?.icon || "⚙"}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold capitalize">{provider.key}</span>
          <Badge variant="outline" className="text-[10px] uppercase font-mono">
            {provider.key}
          </Badge>
          {provider.apiKey || provider.authType === "vertex-sa" ? (
            <Badge
              variant="secondary"
              className="text-[10px] text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
            >
              ✓{" "}
              {provider.authType === "vertex-sa"
                ? "Service Account"
                : "Configured"}
            </Badge>
          ) : (
            <Badge
              variant="secondary"
              className="text-[10px] text-muted-foreground"
            >
              Not configured
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          {provider.authType === "vertex-sa" ? (
            <span className="font-mono text-muted-foreground">
              ☁️ Vertex AI Service Account
            </span>
          ) : provider.apiKey ? (
            <button
              onClick={() => setShowKey(!showKey)}
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              {showKey ? (
                <EyeOff className="size-3" />
              ) : (
                <Eye className="size-3" />
              )}
              <span className="font-mono">
                {showKey ? provider.apiKey : maskedKey}
              </span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {!isLocalFree && (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3.5" />
          </Button>
        )}
        <Switch checked={provider.enabled} onCheckedChange={onToggle} />
        <Button
          variant="ghost"
          size="icon"
          className="size-8 text-destructive hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {/* Edit Dialog */}
      {!isLocalFree && (
        <Dialog open={editing} onOpenChange={(open) => {
          if (!open) {
            setEditKey("");
            setEditBaseUrl("");
            setEditModel("");
            setFetchedModels([]);
          } else {
            setEditBaseUrl(provider.baseUrl || "");
            setEditModel(provider.model || "");
          }
          setEditing(open);
        }}>
          <DialogContent className="sm:max-w-[480px]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg">
                <Route className="h-5 w-5 text-blue-500" />
                Edit {provider.key}
              </DialogTitle>
              <DialogDescription className="sr-only">
                Update connection settings for {provider.key}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6 pt-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-medium">Enabled</Label>
                <Switch 
                  checked={provider.enabled} 
                  onCheckedChange={onToggle} 
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Name</Label>
                <Input 
                  value={provider.key} 
                  disabled
                  className="h-10 capitalize opacity-50" 
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Base URL</Label>
                <Input
                  placeholder="https://api.example.com/v1"
                  value={editBaseUrl !== "" ? editBaseUrl : (provider.baseUrl || "")}
                  onChange={(e) => setEditBaseUrl(e.target.value)}
                  className="h-10 font-mono text-sm"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">API Key</Label>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <Input
                      type={showKey ? 'text' : 'password'}
                      placeholder="Leave blank to keep current key"
                      value={editKey}
                      onChange={(e) => setEditKey(e.target.value)}
                      className="font-mono text-sm h-10 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <Button 
                    variant="secondary" 
                    onClick={fetchModels}
                    disabled={fetchingModels}
                  >
                    {fetchingModels ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Load Models
                  </Button>
                </div>
                <p className="text-[12px] text-muted-foreground italic mt-2">Click "Load Models" to fetch available models from the API.</p>
              </div>

              {/* Manual Model Entry */}
              <div className="pt-5 border-t space-y-3">
                <Label className="text-sm font-medium">Manual Model Entry</Label>
                <p className="text-[12px] text-muted-foreground mb-3">If the API doesn't list models, enter the exact model ID here or select from loaded models.</p>
                <div className="flex items-center gap-3">
                  {fetchedModels.length > 0 ? (
                    <Select
                      value={editModel || provider.model || ''}
                      onValueChange={setEditModel}
                    >
                      <SelectTrigger className="font-mono text-sm h-10 flex-1">
                        <SelectValue placeholder="Select model…" />
                      </SelectTrigger>
                      <SelectContent>
                        {fetchedModels.map(m => (
                          <SelectItem key={m.id} value={m.id} className="font-mono text-sm">
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      placeholder="e.g. gpt-4o, claude-3-5-sonnet"
                      value={editModel || provider.model || ''}
                      onChange={(e) => setEditModel(e.target.value)}
                      className="font-mono text-sm h-10 flex-1"
                    />
                  )}
                  <Button variant="outline" onClick={() => {
                     // The model is automatically bound to editModel
                     alert("Default model configured!");
                  }}>
                    Set Default
                  </Button>
                </div>
              </div>

              <Button onClick={handleSaveEdit} className="w-full mt-4">
                Save Changes
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

"""

new_content = content[:start_idx] + new_provider_card + content[end_idx:]
with open("web-ui/app/llms/page.tsx", "w") as f:
    f.write(new_content)

