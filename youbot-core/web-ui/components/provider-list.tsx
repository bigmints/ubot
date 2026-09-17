"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Star,
  Pencil,
  Trash2,
  Zap,
  RefreshCw,
  Save,
  Eye,
  EyeOff,
} from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────

export interface ProviderConfig {
  enabled?: boolean;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeout?: number;
  [key: string]: unknown;
}

export interface ProviderTypePreset {
  type: string;
  label: string;
  baseUrl: string;
  requiresApiKey: boolean;
  supportsModelDiscovery: boolean;
}

interface ProviderListProps {
  category: string;
  providerTypes: ProviderTypePreset[];
  showModel?: boolean;
  showBaseUrl?: boolean;
  emptyText?: string;
}

// ─── Component ───────────────────────────────────────────

export function ProviderList({
  category,
  providerTypes,
  showModel = true,
  showBaseUrl = true,
  emptyText = "No providers configured",
}: ProviderListProps) {
  const [providers, setProviders] = useState<Record<string, ProviderConfig>>({});
  const [defaultKey, setDefaultKey] = useState("");
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    key: "",
    type: providerTypes[0]?.type || "",
    baseUrl: providerTypes[0]?.baseUrl || "",
    apiKey: "",
    model: "",
  });
  const [formSaving, setFormSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  // Model discovery
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string }[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  // ── Data Loading ──

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ providers: Record<string, ProviderConfig>; default: string }>(
        `/api/integrations/${category}`
      );
      setProviders(data.providers || {});
      setDefaultKey(data.default || "");
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  // ── Model Discovery ──

  const fetchModels = useCallback(
    async (type: string, baseUrl: string, apiKey: string, providerKey?: string) => {
      if (!baseUrl || !showModel) return;
      setModelsLoading(true);
      setModelsError(null);
      try {
        const params = new URLSearchParams({ baseUrl, provider: type });
        if (apiKey) params.set("apiKey", apiKey);
        if (providerKey) params.set("providerKey", providerKey);
        const data = await api<{ models: { id: string; name: string }[]; error?: string }>(
          `/api/integrations/${category}/models?${params}`
        );
        if (data.models?.length > 0) {
          setAvailableModels(data.models);
        } else {
          setAvailableModels([]);
          setModelsError(data.error || "No models found");
        }
      } catch {
        setAvailableModels([]);
        setModelsError("Failed to fetch models");
      } finally {
        setModelsLoading(false);
      }
    },
    [category, showModel]
  );

  // ── Dialog ──

  const openAddDialog = () => {
    const preset = providerTypes[0];
    setEditingKey(null);
    setFormData({
      key: preset?.type || "",
      type: preset?.type || "",
      baseUrl: preset?.baseUrl || "",
      apiKey: "",
      model: "",
    });
    setAvailableModels([]);
    setModelsError(null);
    setShowApiKey(false);
    setDialogOpen(true);
    if (preset?.supportsModelDiscovery && preset.baseUrl) {
      fetchModels(preset.type, preset.baseUrl, "");
    }
  };

  const openEditDialog = (key: string) => {
    const provider = providers[key];
    if (!provider) return;
    setEditingKey(key);
    setFormData({
      key,
      type: providerTypes.find((p) => p.type === key)?.type || key,
      baseUrl: (provider.baseUrl || "") as string,
      apiKey: (provider.apiKey || "") as string,
      model: (provider.model || "") as string,
    });
    setAvailableModels([]);
    setModelsError(null);
    setShowApiKey(false);
    setDialogOpen(true);
    const preset = providerTypes.find((p) => p.type === key);
    if (preset?.supportsModelDiscovery && provider.baseUrl) {
      fetchModels(key, provider.baseUrl as string, (provider.apiKey || "") as string, key);
    }
  };

  const handleTypeChange = (type: string) => {
    const preset = providerTypes.find((p) => p.type === type);
    const newBaseUrl = preset?.baseUrl || formData.baseUrl;
    setFormData((prev) => ({ ...prev, key: type, type, baseUrl: newBaseUrl, model: "" }));
    if (preset?.supportsModelDiscovery && newBaseUrl) {
      fetchModels(type, newBaseUrl, formData.apiKey);
    }
  };

  const handleSave = async () => {
    setFormSaving(true);
    try {
      if (editingKey) {
        await api(`/api/integrations/${category}/${editingKey}`, {
          method: "PUT",
          body: { baseUrl: formData.baseUrl, apiKey: formData.apiKey, model: formData.model },
        });
      } else {
        await api(`/api/integrations/${category}`, {
          method: "POST",
          body: { key: formData.key, baseUrl: formData.baseUrl, apiKey: formData.apiKey, model: formData.model },
        });
      }
      setDialogOpen(false);
      await loadProviders();
      toast.success(editingKey ? "Provider updated" : "Provider added");
    } catch {
      toast.error("Failed to save provider");
    } finally {
      setFormSaving(false);
    }
  };

  const handleDelete = async (key: string) => {
    try {
      await api(`/api/integrations/${category}/${key}`, { method: "DELETE" });
      await loadProviders();
      toast.success("Provider removed");
    } catch {
      toast.error("Failed to remove provider");
    }
  };

  const handleSetDefault = async (key: string) => {
    try {
      await api(`/api/integrations/${category}/${key}/default`, { method: "PUT" });
      await loadProviders();
      toast.success("Default provider updated");
    } catch {
      toast.error("Failed to set default");
    }
  };

  const handleToggle = async (key: string) => {
    try {
      await api(`/api/integrations/${category}/${key}/toggle`, { method: "PUT" });
      await loadProviders();
    } catch {
      toast.error("Failed to toggle provider");
    }
  };

  // ── Render ──

  const currentPreset = providerTypes.find((p) => p.type === formData.type);
  const providerEntries = Object.entries(providers);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <RefreshCw className="size-4 mr-2 animate-spin" /> Loading providers...
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted-foreground">
          {providerEntries.length} provider{providerEntries.length !== 1 ? "s" : ""} configured
        </p>
        <Button onClick={openAddDialog} size="sm">
          <Plus className="size-4 mr-2" /> Add Provider
        </Button>
      </div>

      {providerEntries.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <Zap className="size-10 mx-auto mb-3 opacity-40" />
            <p className="font-medium">{emptyText}</p>
            <Button onClick={openAddDialog} className="mt-4" size="sm">
              <Plus className="size-4 mr-2" /> Add Provider
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {providerEntries.map(([key, provider]) => {
            const isDefault = key === defaultKey;
            const isEnabled = provider.enabled !== false;
            return (
              <Card
                key={key}
                className={`${isDefault ? "border-primary/50 bg-primary/[0.03]" : ""} ${!isEnabled ? "opacity-60" : ""}`}
              >
                <CardContent className="py-4 px-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div
                        className={`mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg ${
                          isDefault ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <Zap className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate capitalize">{key}</span>
                          <Badge variant="outline" className="text-xs shrink-0">
                            {(providerTypes.find((p) => p.type === key)?.label || key).toUpperCase()}
                          </Badge>
                          {isDefault && (
                            <Badge className="bg-primary/15 text-primary border-primary/25 text-xs shrink-0">
                              <Star className="size-3 mr-1 fill-current" /> Default
                            </Badge>
                          )}
                          {!isEnabled && (
                            <Badge variant="secondary" className="text-xs shrink-0">Disabled</Badge>
                          )}
                        </div>
                        {provider.model && (
                          <p className="text-sm text-muted-foreground mt-0.5 truncate">{provider.model as string}</p>
                        )}
                        {provider.baseUrl && (
                          <p className="text-xs text-muted-foreground/70 mt-0.5 truncate">{provider.baseUrl as string}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 ml-3">
                      <Switch checked={isEnabled} onCheckedChange={() => handleToggle(key)} className="mr-1" />
                      {!isDefault && isEnabled && (
                        <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => handleSetDefault(key)}>
                          <Star className="size-3.5 mr-1" /> Default
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => openEditDialog(key)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(key)}
                        disabled={isDefault && providerEntries.length > 1}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Add / Edit Dialog ── */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{editingKey ? "Edit Provider" : "Add Provider"}</DialogTitle>
            <DialogDescription>
              {editingKey ? "Update the provider configuration." : "Configure a new provider."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            {!editingKey && (
              <div className="grid gap-2">
                <Label>Provider Type</Label>
                <Select value={formData.type} onValueChange={handleTypeChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select provider" />
                  </SelectTrigger>
                  <SelectContent>
                    {providerTypes.map((p) => (
                      <SelectItem key={p.type} value={p.type}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {showBaseUrl && (
              <div className="grid gap-2">
                <Label htmlFor="providerBaseUrl">Base URL</Label>
                <Input
                  id="providerBaseUrl"
                  placeholder="https://api.example.com/v1/"
                  value={formData.baseUrl}
                  onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value, model: "" })}
                  onBlur={() => {
                    if (formData.baseUrl && currentPreset?.supportsModelDiscovery) {
                      fetchModels(formData.type, formData.baseUrl, formData.apiKey);
                    }
                  }}
                />
              </div>
            )}

            {showModel && (
              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label>Model</Label>
                  {modelsLoading && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <RefreshCw className="size-3 animate-spin" /> Loading...
                    </span>
                  )}
                </div>
                {availableModels.length > 0 ? (
                  <Select value={formData.model} onValueChange={(v) => setFormData({ ...formData, model: v })}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a model" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableModels.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    placeholder={modelsLoading ? "Loading..." : "Enter model name"}
                    value={formData.model}
                    onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                    disabled={modelsLoading}
                  />
                )}
                {modelsError && <p className="text-xs text-amber-700 dark:text-amber-500">Could not fetch models. Type a model name manually.</p>}
              </div>
            )}

            {currentPreset?.requiresApiKey !== false && (
              <div className="grid gap-2">
                <Label>API Key</Label>
                <div className="relative">
                  <Input
                    type={showApiKey ? "text" : "password"}
                    placeholder={editingKey ? "Leave blank to keep existing" : "Enter API key"}
                    value={formData.apiKey}
                    onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                    onBlur={() => {
                      if (formData.baseUrl && formData.apiKey && currentPreset?.supportsModelDiscovery) {
                        fetchModels(formData.type, formData.baseUrl, formData.apiKey);
                      }
                    }}
                    className="pr-10"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 size-7"
                    onClick={() => setShowApiKey(!showApiKey)}
                  >
                    {showApiKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={formSaving || (!editingKey && !formData.key)}>
              {formSaving ? <RefreshCw className="size-4 mr-2 animate-spin" /> : <Save className="size-4 mr-2" />}
              {editingKey ? "Update" : "Add Provider"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
