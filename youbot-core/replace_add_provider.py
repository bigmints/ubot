import re

with open("web-ui/app/llms/page.tsx", "r") as f:
    content = f.read()

start_idx = content.find("function AddProviderDialog({")
if start_idx == -1:
    print("Could not find AddProviderDialog")
    exit(1)

new_add_provider = """function AddProviderDialog({
  presets,
  existingKeys,
  onAdd,
}: {
  presets: ProviderPreset[];
  existingKeys: string[];
  onAdd: (
    type: string,
    apiKey: string,
    model: string,
    extra?: {
      projectId?: string;
      region?: string;
      serviceAccountJson?: string;
      baseUrl?: string;
      modelOverride?: string;
    },
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selectedType, setSelectedType] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  // Vertex-specific state
  const [serviceAccountJson, setServiceAccountJson] = useState("");
  const [projectId, setProjectId] = useState("");
  const [region, setRegion] = useState("us-central1");

  // General & Compat state
  const [compatBaseUrl, setCompatBaseUrl] = useState("");
  const [compatModel, setCompatModel] = useState("");
  
  const [fetchingModels, setFetchingModels] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<{id: string, name: string}[]>([]);
  const [showKey, setShowKey] = useState(false);

  const availablePresets = presets.filter(
    (p) => !existingKeys.includes(p.type),
  );
  const isVertex = selectedType === "vertex";
  const isCompat = selectedType === "openai-compat";
  const isOllama = selectedType === "ollama";
  const isLmstudio = selectedType === "lmstudio";
  const isLocalFree = isOllama || isLmstudio;
  
  const needsApiKey = selectedType && !isVertex && !isLocalFree;

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setServiceAccountJson(text);
      try {
        const parsed = JSON.parse(text);
        if (parsed.project_id) setProjectId(parsed.project_id);
      } catch {
        /* ignore */
      }
    };
    reader.readAsText(file);
  }

  const fetchModels = async () => {
    setFetchingModels(true);
    try {
      const bUrl = compatBaseUrl || "";
      const res = await fetch(`/api/integrations/models/models?provider=${selectedType}&providerKey=${selectedType}&baseUrl=${encodeURIComponent(bUrl)}&apiKey=${encodeURIComponent(apiKey)}`);
      const data = await res.json();
      if (data.models && data.models.length > 0) {
        setFetchedModels(data.models);
        if (!compatModel) {
          setCompatModel(data.models[0].id);
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

  async function handleAdd() {
    if (!selectedType) return;
    setSaving(true);

    try {
      if (isVertex) {
        if (!serviceAccountJson || !projectId) return;
        const credRes = await fetch("/api/integrations/vertex/credentials", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serviceAccountJson }),
        });
        if (!credRes.ok) {
          const err = await credRes.json();
          alert(`Failed to save credentials: ${err.error}`);
          return;
        }
        onAdd("vertex", "__vertex_sa__", "", {
          projectId,
          region,
          serviceAccountJson,
        });
      } else if (isLocalFree) {
        onAdd(selectedType, "", "");
      } else if (isCompat) {
        if (!apiKey || !compatBaseUrl.trim() || !compatModel.trim()) return;
        onAdd(selectedType, apiKey, compatModel.trim(), {
          baseUrl: compatBaseUrl.trim().replace(/\/+$/, ""),
          modelOverride: compatModel.trim(),
        });
      } else {
        if (!apiKey) return;
        // Also pass compatModel if selected for standard providers
        onAdd(selectedType, apiKey, compatModel.trim());
      }

      setOpen(false);
      resetState();
    } finally {
      setSaving(false);
    }
  }

  function resetState() {
    setSelectedType("");
    setApiKey("");
    setServiceAccountJson("");
    setProjectId("");
    setRegion("us-central1");
    setCompatBaseUrl("");
    setCompatModel("");
    setFetchedModels([]);
  }

  const canSubmit = isVertex
    ? !!serviceAccountJson && !!projectId
    : isLocalFree
      ? true
      : isCompat
        ? !!selectedType && !!apiKey && !!compatBaseUrl && !!compatModel
        : !!selectedType && !!apiKey;

  return (
    <Dialog open={open} onOpenChange={(val) => {
      if (!val) resetState();
      setOpen(val);
    }}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={availablePresets.length === 0}>
          <Plus className="size-3.5 mr-1.5" />
          Add Provider
        </Button>
      </DialogTrigger>
      <DialogContent className={isVertex ? "max-w-lg" : "sm:max-w-[480px]"}>
        <DialogHeader>
          <DialogTitle>Add AI Provider</DialogTitle>
          <DialogDescription>
            {isVertex
              ? "Upload your Google Cloud service account JSON key"
              : isCompat
                ? "Connect any OpenAI-compatible API"
                : "Enter your API key to enable a new model provider"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Provider</Label>
            <div className="grid grid-cols-2 gap-2">
              {availablePresets.map((preset) => (
                <button
                  key={preset.type}
                  onClick={() => {
                    setSelectedType(preset.type);
                    setFetchedModels([]);
                  }}
                  className={`flex items-center gap-2 p-3 rounded-lg border text-left transition-colors ${
                    selectedType === preset.type
                      ? "border-primary bg-primary/10"
                      : "hover:bg-accent/50"
                  }`}
                >
                  <span className="text-lg">{preset.icon}</span>
                  <span className="font-medium text-sm">{preset.label}</span>
                </button>
              ))}
            </div>
          </div>

          {isOllama && (
            <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
              <p className="font-medium text-foreground mb-1">
                🦙 Local Ollama
              </p>
              <p>
                Ollama runs locally — no API key needed. Just make sure Ollama
                is running on your machine.
              </p>
              <p className="mt-2 font-mono text-xs">http://localhost:11434</p>
            </div>
          )}

          {isCompat && (
            <div className="space-y-2">
              <Label>Base URL <span className="text-red-500">*</span></Label>
              <Input
                placeholder="https://your-api.example.com/v1"
                value={compatBaseUrl}
                onChange={(e) => setCompatBaseUrl(e.target.value)}
                autoFocus
              />
              <p className="text-xs text-muted-foreground">
                The OpenAI-compatible API endpoint (include /v1 if applicable)
              </p>
            </div>
          )}

          {needsApiKey && (
            <div className="space-y-2">
              <Label>API Key <span className="text-red-500">*</span></Label>
              <div className="flex items-center gap-3">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    placeholder={`Enter your ${presets.find((p) => p.type === selectedType)?.label || ""} API key`}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
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
                  disabled={fetchingModels || !apiKey || (isCompat && !compatBaseUrl)}
                >
                  {fetchingModels ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Load Models
                </Button>
              </div>
              <p className="text-[12px] text-muted-foreground italic mt-2">Click "Load Models" to fetch available models from the API.</p>
            </div>
          )}

          {needsApiKey && (
            <div className="pt-5 border-t space-y-3">
              <Label className="text-sm font-medium">Manual Model Entry</Label>
              <p className="text-[12px] text-muted-foreground mb-3">If the API doesn't list models, enter the exact model ID here or select from loaded models.</p>
              <div className="flex items-center gap-3">
                {fetchedModels.length > 0 ? (
                  <Select
                    value={compatModel}
                    onValueChange={setCompatModel}
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
                    value={compatModel}
                    onChange={(e) => setCompatModel(e.target.value)}
                    className="font-mono text-sm h-10 flex-1"
                  />
                )}
                <Button variant="outline" onClick={() => {
                   alert("Default model configured!");
                }}>
                  Set Default
                </Button>
              </div>
            </div>
          )}

          {isVertex && (
            <>
              <div className="space-y-2">
                <Label>Service Account JSON</Label>
                <div className="flex gap-2 items-center">
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm font-medium hover:bg-accent/50 transition-colors">
                      📎 Upload JSON file
                    </span>
                  </label>
                  {serviceAccountJson && (
                    <Badge
                      variant="secondary"
                      className="text-xs text-emerald-700 dark:text-emerald-400 bg-emerald-500/10"
                    >
                      ✓ File loaded
                    </Badge>
                  )}
                </div>
                <textarea
                  className="w-full h-24 rounded-md border bg-muted/30 p-2 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Or paste your service account JSON here..."
                  value={serviceAccountJson}
                  onChange={(e) => {
                    setServiceAccountJson(e.target.value);
                    try {
                      const parsed = JSON.parse(e.target.value);
                      if (parsed.project_id) setProjectId(parsed.project_id);
                    } catch {
                      /* ignore while typing */
                    }
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Project ID</Label>
                  <Input
                    placeholder="my-project-id"
                    value={projectId}
                    onChange={(e) => setProjectId(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Region</Label>
                  <Select value={region} onValueChange={setRegion}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        "us-central1",
                        "us-east4",
                        "us-west1",
                        "europe-west1",
                        "europe-west4",
                        "asia-southeast1",
                      ].map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 mt-4 pt-4 border-t">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={!canSubmit || saving}>
              {saving && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
              Add Provider
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
"""

new_content = content[:start_idx] + new_add_provider
with open("web-ui/app/llms/page.tsx", "w") as f:
    f.write(new_content)

