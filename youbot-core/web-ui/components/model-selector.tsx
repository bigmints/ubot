"use client";

/**
 * ModelSelector — Dialog-based model picker grouped by enabled LLM providers.
 *
 * Pattern: trigger button → Dialog with search input + scrollable grouped list.
 * - "Recently Used" section pins models with recorded usage to the top.
 * - Call count badge shown on each model row.
 * - All values stored as `providerId/modelId` for unambiguous routing.
 *   e.g. "openrouter/qwen/qwen3.6-plus:free", "lmstudio/gemma-4-e4b-it"
 */

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Loader2, Search, ChevronsUpDown, Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Provider display metadata ────────────────────────────────

const PROVIDER_META: Record<string, { label: string; icon: string }> = {
  gemini:     { label: "Gemini",     icon: "✦" },
  openai:     { label: "OpenAI",     icon: "◎" },
  openrouter: { label: "OpenRouter", icon: "⬡" },
  vertex:     { label: "Vertex AI",  icon: "△" },
  ollama:     { label: "Ollama",     icon: "🦙" },
  lmstudio:   { label: "LM Studio",  icon: "🖥️" },
};

function getProviderMeta(key: string) {
  return PROVIDER_META[key] || { label: key, icon: "⚙" };
}

/** Always prefix with providerId for unambiguous routing keys */
function toRoutingValue(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

/** Extract readable display name from a routing value like "openrouter/qwen/qwen3.6-plus:free" */
function displayName(routingValue: string): string {
  if (!routingValue || routingValue === "__default__") return "";
  const slashIdx = routingValue.indexOf("/");
  if (slashIdx === -1) return routingValue;
  return routingValue.slice(slashIdx + 1); // strip provider prefix
}

// ── Types ────────────────────────────────────────────────────

interface ModelItem {
  id: string;
  name: string;
  calls?: number; // from metering
  pricing?: { prompt: string | number; completion: string | number };
  context_length?: number;
}

interface ProviderGroup {
  providerId: string;
  label: string;
  icon: string;
  isDefault: boolean;
  models: ModelItem[];
}

type UsageMap = Record<string, number>; // modelId → call count

interface ModelSelectorProps {
  value?: string;
  onChange: (model: string | undefined) => void;
  inheritLabel?: string;
  className?: string;
}

// ── Component ────────────────────────────────────────────────

export function ModelSelector({
  value,
  onChange,
  inheritLabel = "Auto",
  className,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<ProviderGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // ── Load models ──────────────────────────────────────────

  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch usage data alongside providers (best-effort)
      const usagePromise = fetch("/api/metering/usage?period=30d")
        .then((r) => r.ok ? r.json() : {})
        .catch(() => ({}));

      const provRes = await fetch("/api/integrations/models");
      if (!provRes.ok) return;
      const provData = await provRes.json();
      const defaultKey: string = provData.default || "";

      interface ProviderData {
        enabled?: boolean; apiKey?: string; authType?: string;
        key?: string; baseUrl?: string; model?: string;
      }

      const enabledProviders = Object.entries(provData.providers || {} as Record<string, ProviderData>)
        .filter(([, p]) => (p as ProviderData).enabled !== false)
        .filter(([, p]) => {
          const pd = p as ProviderData;
          return pd.apiKey || pd.authType === "vertex-sa"
            || ["ollama", "lmstudio"].includes(pd.key || "")
            || (pd.baseUrl && pd.baseUrl.includes("localhost"));
        })
        .map(([key, p]) => {
          const pd = p as ProviderData;
          return { key, baseUrl: pd.baseUrl || "", apiKey: pd.apiKey || "", model: pd.model || "", isDefault: key === defaultKey };
        });

      const results = await Promise.allSettled(
        enabledProviders.map(async (prov) => {
          const params = new URLSearchParams({
            providerId: prov.key, baseUrl: prov.baseUrl,
            apiKey: prov.apiKey, provider: prov.key,
          });
          try {
            const res = await fetch(`/api/llm-providers/models?${params}`);
            if (res.ok) {
              const data = await res.json();
              const meta = getProviderMeta(prov.key);
              return {
                providerId: prov.key,
                label: meta.label,
                icon: meta.icon,
                isDefault: prov.isDefault,
                models: (data.models || []) as ModelItem[],
              } satisfies ProviderGroup;
            }
          } catch { /* fall through */ }
          // Fallback: configured default model only
          if (prov.model) {
            const meta = getProviderMeta(prov.key);
            return {
              providerId: prov.key, label: meta.label, icon: meta.icon,
              isDefault: prov.isDefault,
              models: [{ id: prov.model, name: prov.model }],
            } satisfies ProviderGroup;
          }
          return null;
        })
      );

      const resolved = results
        .filter((r): r is PromiseFulfilledResult<ProviderGroup | null> => r.status === "fulfilled")
        .map((r) => r.value)
        .filter((g): g is ProviderGroup => g !== null && g.models.length > 0)
        .sort((a, b) => {
          if (a.isDefault && !b.isDefault) return -1;
          if (!a.isDefault && b.isDefault) return 1;
          return a.providerId.localeCompare(b.providerId);
        });

      // Resolve usage data and annotate models with call counts
      const usageData = await usagePromise as { byModel?: Record<string, { calls: number }> };
      const byModel: Record<string, { calls: number }> = usageData?.byModel || {};
      const usageMap: UsageMap = Object.fromEntries(
        Object.entries(byModel).map(([model, data]) => [model, data.calls])
      );

      // Annotate models with call counts
      const annotated = resolved.map((g) => ({
        ...g,
        models: g.models.map((m) => ({
          ...m,
          calls: usageMap[m.id] ?? usageMap[`${g.providerId}/${m.id}`] ?? 0,
        })),
      }));

      setGroups(annotated);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadModels(); }, [loadModels]);

  // Reset search when dialog closes, refocus on open
  useEffect(() => {
    if (!open) {
      setSearch("");
    } else {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  // ── Recently used ────────────────────────────────────────

  const recentlyUsed = useMemo(() => {
    const used: Array<{ providerId: string; model: ModelItem; providerLabel: string; providerIcon: string }> = [];
    for (const g of groups) {
      for (const m of g.models) {
        if ((m.calls ?? 0) > 0) {
          used.push({ providerId: g.providerId, model: m, providerLabel: g.label, providerIcon: g.icon });
        }
      }
    }
    return used.sort((a, b) => (b.model.calls ?? 0) - (a.model.calls ?? 0)).slice(0, 5);
  }, [groups]);

  // ── Filtered groups ──────────────────────────────────────

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        models: g.models.filter(
          (m) => m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
        ),
      }))
      .filter((g) => g.models.length > 0);
  }, [groups, search]);

  const totalModels = groups.reduce((s, g) => s + g.models.length, 0);
  const selectedDisplay = value ? displayName(value) : "";

  // ── Handle selection ─────────────────────────────────────

  function handleSelect(routingVal: string) {
    onChange(routingVal === "__auto__" ? undefined : routingVal);
    setOpen(false);
  }

  // ── Render ───────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between font-normal text-left", className)}
        >
          <span className="truncate text-sm">
            {selectedDisplay
              ? <span className="font-mono">{selectedDisplay}</span>
              : <span className="text-muted-foreground">{inheritLabel}</span>
            }
          </span>
          <ChevronsUpDown className="ml-2 size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-3xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-3 border-b">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="size-4 text-muted-foreground" />
            Select Model
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
          {loading ? "Loading…" : `${totalModels} models across ${groups.length} provider${groups.length !== 1 ? "s" : ""}${recentlyUsed.length > 0 ? ` · ${recentlyUsed.length} recently used` : ""}`}
        </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="px-4 py-2.5 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              placeholder="Search models…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-9 text-sm"
            />
          </div>
        </div>

        {/* Model list */}
        <div className="overflow-y-auto max-h-[380px]">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground text-sm gap-2">
              <Loader2 className="size-4 animate-spin" />
              Loading models…
            </div>
          ) : (
            <>
              {/* Auto option */}
              <button
                onClick={() => handleSelect("__auto__")}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-2.5 text-sm text-left hover:bg-accent/60 transition-colors",
                  !value && "bg-accent/40"
                )}
              >
                <span className="w-5 text-center text-base">✦</span>
                <div className="flex-1 min-w-0">
                  <span className="text-muted-foreground">{inheritLabel}</span>
                </div>
                {!value && <Check className="size-3.5 text-primary shrink-0" />}
              </button>

              {/* Recently used section */}
              {recentlyUsed.length > 0 && !search && (
                <div>
                  <div className="flex items-center gap-2 px-4 py-1.5 bg-muted/40 border-y">
                    <span className="text-sm">🕐</span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recently Used</span>
                  </div>
                  {recentlyUsed.map(({ providerId, model, providerIcon }) => {
                    const routingVal = toRoutingValue(providerId, model.id);
                    const isSelected = value === routingVal;
                    return (
                      <button
                        key={`recent-${routingVal}`}
                        onClick={() => handleSelect(routingVal)}
                        className={cn(
                          "w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-accent/60 transition-colors",
                          isSelected && "bg-accent/40"
                        )}
                      >
                        <span className="w-5 text-center text-xs">{providerIcon}</span>
                        <span className="flex-1 font-mono text-xs truncate">{model.name}</span>
                        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{model.calls} calls</span>
                        {isSelected && <Check className="size-3.5 text-primary shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Provider groups */}
              {filteredGroups.map((group) => (
                <div key={group.providerId}>
                  {/* Provider header */}
                  <div className="flex items-center gap-2 px-4 py-1.5 bg-muted/40 border-y">
                    <span className="text-sm">{group.icon}</span>
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {group.label}
                    </span>
                    {group.isDefault && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-auto">default</Badge>
                    )}
                  </div>

                  {/* Table Header (only if models have pricing) */}
                  {group.models.some(m => m.pricing) && (
                    <div className="flex items-center gap-3 px-4 py-1 text-[10px] uppercase font-semibold text-muted-foreground bg-muted/20 border-b">
                      <span className="w-5" />
                      <span className="flex-1">Model</span>
                      <span className="w-[60px] text-right">Context</span>
                      <span className="w-[70px] text-right">Input/1M</span>
                      <span className="w-[70px] text-right">Output/1M</span>
                      <span className="w-4" />
                    </div>
                  )}

                  {/* Models — sorted by usage desc */}
                  {[...group.models]
                    .sort((a, b) => (b.calls ?? 0) - (a.calls ?? 0))
                    .map((m) => {
                      const routingVal = toRoutingValue(group.providerId, m.id);
                      const isSelected = value === routingVal;
                      return (
                        <button
                          key={routingVal}
                          onClick={() => handleSelect(routingVal)}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-2 text-sm text-left hover:bg-accent/60 transition-colors",
                            isSelected && "bg-accent/40"
                          )}
                        >
                          <span className="w-5" />
                          <span className="flex-1 font-mono text-xs truncate">{m.name}</span>
                          
                          {m.pricing ? (
                            <>
                              <span className="w-[60px] text-right text-[10px] text-muted-foreground tabular-nums">
                                {m.context_length ? `${Math.round(m.context_length / 1000)}K` : '-'}
                              </span>
                              <span className="w-[70px] text-right text-[10px] text-muted-foreground tabular-nums">
                                {Number(m.pricing.prompt) === 0 ? 'Free' : `$${(Number(m.pricing.prompt)*1000000).toFixed(2)}`}
                              </span>
                              <span className="w-[70px] text-right text-[10px] text-muted-foreground tabular-nums">
                                {Number(m.pricing.completion) === 0 ? 'Free' : `$${(Number(m.pricing.completion)*1000000).toFixed(2)}`}
                              </span>
                            </>
                          ) : (
                            (m.calls ?? 0) > 0 && (
                              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{m.calls} calls</span>
                            )
                          )}
                          
                          <span className="w-4 flex justify-end">
                            {isSelected && <Check className="size-3.5 text-primary shrink-0" />}
                          </span>
                        </button>
                      );
                    })}
                </div>
              ))}

              {filteredGroups.length === 0 && search && (
                <div className="py-10 text-center text-sm text-muted-foreground">
                  No models matching &quot;{search}&quot;
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
