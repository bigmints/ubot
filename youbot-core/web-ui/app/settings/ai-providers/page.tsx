"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  AudioLines,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn,
  MessageCircle,
  PlugZap,
  Server,
  ShieldCheck,
  Trash2,
  Volume2,
} from "lucide-react";

import { StandardPage } from "@/components/workspace-frame";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ProviderModel { id: string; name: string }
interface Provider {
  id: string;
  name: string;
  methods: Array<"subscription" | "api-key">;
  connected: boolean;
  configured: boolean;
  credentialType?: "subscription" | "api-key" | "none";
  custom: boolean;
  keyless: boolean;
  subscriptionLabel?: string;
  accountLabel?: string;
  models: ProviderModel[];
}
interface ProviderState {
  status: "idle" | "waiting" | "authenticated" | "failed";
  providers: Provider[];
  message?: string;
  authUrl?: string;
  deviceCode?: string;
  prompt?: {
    id: string;
    type: string;
    message: string;
    options?: Array<{ id: string; label: string }>;
  };
  activeProviderId?: string;
  activeModelId?: string;
  enabledProviderIds: string[];
  routing?: Partial<Record<RoutingPurpose, RoutingSelection>>;
}

type RoutingPurpose = "chat" | "transcription" | "tts";
interface RoutingSelection { providerId: string; modelId: string }
const INHERIT_ROUTE = "__inherit__";

function routingValue(selection?: RoutingSelection): string {
  return selection ? JSON.stringify([selection.providerId, selection.modelId]) : INHERIT_ROUTE;
}

async function providerApi<T>(url = "/api/provider-access", options?: RequestInit & { body?: string }): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  return response.json();
}

function ProviderChoice({
  icon: Icon,
  title,
  description,
  action,
  onClick,
}: {
  icon: typeof LogIn;
  title: string;
  description: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/30"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span>
        <span className="mt-2 block text-xs font-medium text-primary group-hover:underline">{action}</span>
      </span>
    </button>
  );
}

export default function AiProvidersPage() {
  const [data, setData] = useState<ProviderState | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [dialog, setDialog] = useState<"subscription" | "api-key" | "custom" | null>(null);
  const [subscriptionProvider, setSubscriptionProvider] = useState("openai-codex");
  const [keyProvider, setKeyProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [customName, setCustomName] = useState("");
  const [customUrl, setCustomUrl] = useState("");
  const [customKey, setCustomKey] = useState("");
  const [verifiedModels, setVerifiedModels] = useState<ProviderModel[] | null>(null);
  const [customModel, setCustomModel] = useState("");
  const [selectedModels, setSelectedModels] = useState<Record<string, string>>({});
  const [promptValue, setPromptValue] = useState("");
  const [subscriptionStarted, setSubscriptionStarted] = useState(false);
  const [routingDraft, setRoutingDraft] = useState<Record<RoutingPurpose, string>>({
    chat: INHERIT_ROUTE,
    transcription: INHERIT_ROUTE,
    tts: INHERIT_ROUTE,
  });

  const load = useCallback(async () => {
    try {
      const next = await providerApi<ProviderState>();
      setData(next);
      if (next.status === "failed" && next.message) setError(next.message);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load AI providers.");
      return null;
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (data?.status !== "waiting") return;
    const timer = window.setInterval(() => void load(), 1200);
    return () => window.clearInterval(timer);
  }, [data?.status, load]);

  useEffect(() => {
    if (!subscriptionStarted || data?.status !== "authenticated") return;
    setSubscriptionStarted(false);
    setDialog(null);
    setNotice("Subscription connected securely.");
  }, [data?.status, subscriptionStarted]);

  useEffect(() => {
    if (!data) return;
    const chatgpt = data.providers.find((provider) => provider.id === "openai-codex");
    const subscription = chatgpt ?? data.providers.find((provider) => provider.methods.includes("subscription"));
    const openai = data.providers.find((provider) => provider.id === "openai");
    const keyed = openai ?? data.providers.find((provider) => provider.methods.includes("api-key") && !provider.custom);
    if (subscription) setSubscriptionProvider((current) => current || subscription.id);
    if (keyed) setKeyProvider((current) => current || keyed.id);
  }, [data]);

  useEffect(() => {
    if (!data) return;
    const fallback = data.activeProviderId && data.activeModelId
      ? { providerId: data.activeProviderId, modelId: data.activeModelId }
      : undefined;
    setRoutingDraft({
      chat: routingValue(data.routing?.chat ?? fallback),
      transcription: routingValue(data.routing?.transcription),
      tts: routingValue(data.routing?.tts),
    });
  }, [data]);

  const subscriptions = useMemo(
    () => data?.providers.filter((provider) => provider.methods.includes("subscription")) ?? [],
    [data],
  );
  const keyProviders = useMemo(
    () => data?.providers.filter((provider) => provider.methods.includes("api-key") && !provider.custom) ?? [],
    [data],
  );
  const connected = useMemo(
    () => data?.providers.filter((provider) => provider.connected) ?? [],
    [data],
  );
  const routingOptions = useMemo(
    () => connected.flatMap((provider) => data?.enabledProviderIds.includes(provider.id)
      ? provider.models.map((model) => ({
          value: routingValue({ providerId: provider.id, modelId: model.id }),
          providerId: provider.id,
          modelId: model.id,
          label: `${provider.name} · ${model.name}`,
        }))
      : []),
    [connected, data?.enabledProviderIds],
  );

  async function run(id: string, action: () => Promise<ProviderState>, success?: string): Promise<ProviderState | null> {
    setBusy(id);
    setError("");
    setNotice("");
    try {
      const next = await action();
      setData(next);
      if (success) setNotice(success);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The provider could not be updated.");
      return null;
    } finally {
      setBusy("");
    }
  }

  function closeDialog(open: boolean) {
    if (open) return;
    setDialog(null);
    setVerifiedModels(null);
    setCustomModel("");
    setPromptValue("");
    setSubscriptionStarted(false);
    if (data?.status === "waiting") {
      void providerApi<ProviderState>("/api/provider-access/cancel", { method: "POST", body: "{}" }).then(setData);
    }
  }

  async function startSubscription() {
    setBusy("subscription");
    setError("");
    setNotice("");
    try {
      const next = await providerApi<ProviderState>("/api/provider-access/subscription", {
        method: "POST",
        body: JSON.stringify({ providerId: subscriptionProvider }),
      });
      setData(next);
      setSubscriptionStarted(true);
    } catch (cause) {
      setSubscriptionStarted(false);
      setError(cause instanceof Error ? cause.message : "Subscription sign-in could not start.");
    } finally {
      setBusy("");
    }
  }

  async function respondToPrompt() {
    if (!data?.prompt) return;
    await run("prompt", () => providerApi("/api/provider-access/respond", {
      method: "POST",
      body: JSON.stringify({ id: data.prompt!.id, value: promptValue }),
    }));
    setPromptValue("");
  }

  async function saveKey() {
    await run("api-key", () => providerApi("/api/provider-access/api-key", {
      method: "POST",
      body: JSON.stringify({ providerId: keyProvider, apiKey }),
    }), "API key saved securely.");
    setApiKey("");
    setDialog(null);
  }

  async function verifyCustom() {
    setBusy("verify-custom");
    setError("");
    try {
      const result = await providerApi<{ models: ProviderModel[] }>("/api/provider-access/custom/verify", {
        method: "POST",
        body: JSON.stringify({ name: customName, baseUrl: customUrl, apiKey: customKey }),
      });
      setVerifiedModels(result.models);
      setCustomModel(result.models[0]?.id ?? "");
    } catch (cause) {
      setVerifiedModels(null);
      setCustomModel("");
      setError(cause instanceof Error ? cause.message : "Could not verify this endpoint.");
    } finally {
      setBusy("");
    }
  }

  async function addCustom() {
    const next = await run("add-custom", () => providerApi("/api/provider-access/custom", {
      method: "POST",
      body: JSON.stringify({ name: customName, baseUrl: customUrl, apiKey: customKey, modelId: customModel }),
    }), `${customName.trim()} is connected and ready to use.`);
    if (!next) return;
    setCustomName("");
    setCustomUrl("");
    setCustomKey("");
    setVerifiedModels(null);
    setCustomModel("");
    setDialog(null);
  }

  async function saveRouting() {
    const selection = (value: string): RoutingSelection | null => {
      if (value === INHERIT_ROUTE) return null;
      const option = routingOptions.find((item) => item.value === value);
      return option ? { providerId: option.providerId, modelId: option.modelId } : null;
    };
    const chat = selection(routingDraft.chat);
    if (!chat) {
      setError("Choose a conversation model first.");
      return;
    }
    await run("routing", () => providerApi("/api/provider-access/routing", {
      method: "PUT",
      body: JSON.stringify({
        routing: {
          chat,
          transcription: selection(routingDraft.transcription),
          tts: selection(routingDraft.tts),
        },
      }),
    }), "Model routing saved.");
  }

  async function activateProvider(provider: Provider) {
    const modelId = selectedModels[provider.id]
      ?? (provider.id === data?.activeProviderId ? data.activeModelId : undefined)
      ?? provider.models[0]?.id;
    if (!modelId) return;
    await run(`use-${provider.id}`, () => providerApi("/api/provider-access/active", {
      method: "PUT",
      body: JSON.stringify({ providerId: provider.id, modelId }),
    }), `${provider.name} is now powering Youbot.`);
  }

  async function disableProvider(provider: Provider) {
    await run(`disable-${provider.id}`, () => providerApi(`/api/provider-access/${encodeURIComponent(provider.id)}/disable`, {
      method: "POST",
      body: "{}",
    }), `${provider.name} disabled.`);
  }

  async function removeProvider(provider: Provider) {
    if (!window.confirm(`Remove ${provider.name} from Youbot?`)) return;
    await run(`remove-${provider.id}`, () => providerApi(`/api/provider-access/${encodeURIComponent(provider.id)}`, {
      method: "DELETE",
    }), `${provider.name} removed.`);
  }

  const waiting = data?.status === "waiting";

  return (
    <StandardPage title="AI providers" description="Connect providers and choose which model handles each job.">
      {error ? <Alert variant="destructive"><CircleAlert /><AlertDescription>{error}</AlertDescription></Alert> : null}
      {notice ? <Alert><CheckCircle2 /><AlertDescription>{notice}</AlertDescription></Alert> : null}

      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Model routing</h2>
            <p className="mt-1 text-sm text-muted-foreground">Choose the model Youbot uses for conversation and audio.</p>
          </div>
          <Button size="sm" disabled={routingOptions.length === 0 || routingDraft.chat === INHERIT_ROUTE || busy === "routing"} onClick={() => void saveRouting()}>
            {busy === "routing" ? <Loader2 className="size-4 animate-spin" /> : null}
            Save routing
          </Button>
        </div>
        <div className="divide-y rounded-xl border bg-card">
          {([
            { purpose: "chat", label: "Conversation", description: "Visitor replies and owner conversations.", icon: MessageCircle },
            { purpose: "transcription", label: "Transcription", description: "Voice notes and uploaded audio to text.", icon: AudioLines },
            { purpose: "tts", label: "Text to speech", description: "Spoken replies and generated voice notes.", icon: Volume2 },
          ] as const).map(({ purpose, label, description, icon: Icon }) => (
          <div key={purpose} className="grid gap-3 p-4 xl:grid-cols-[minmax(180px,1fr)_minmax(260px,420px)] xl:items-center">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></span>
                <div className="min-w-0">
                  <p className="text-sm font-medium">{label}</p>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>
                </div>
              </div>
              <Select value={routingDraft[purpose]} onValueChange={(value) => setRoutingDraft((current) => ({ ...current, [purpose]: value }))}>
                <SelectTrigger className="w-full" aria-label={`${label} model`}><SelectValue placeholder="Choose a model" /></SelectTrigger>
                <SelectContent>
                  {purpose !== "chat" ? <SelectItem value={INHERIT_ROUTE}>Use conversation model</SelectItem> : null}
                  {routingOptions.map((option) => <SelectItem key={`${purpose}-${option.value}`} value={option.value}>{option.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
        {data && routingOptions.length === 0 ? <p className="text-sm text-muted-foreground">Connect and enable a provider to set model routing.</p> : null}
      </section>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">Connected providers</h2>
            <p className="mt-1 text-sm text-muted-foreground">Manage the providers and models available to routing.</p>
          </div>
          <Badge variant="secondary">{connected.length} connected</Badge>
        </div>

        {data && connected.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No AI provider is connected yet.
          </div>
        ) : null}
        {!data ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading providers…</div>
        ) : null}

        <div className="space-y-3">
          {connected.map((provider) => {
            const active = provider.id === data?.activeProviderId;
            const enabled = data?.enabledProviderIds.includes(provider.id);
            const selected = selectedModels[provider.id]
              ?? (active ? data?.activeModelId : undefined)
              ?? provider.models[0]?.id
              ?? "";
            return (
              <Card key={provider.id}>
                <CardHeader className="gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <CardTitle className="text-base">{provider.name}</CardTitle>
                      {active ? <Badge>Active</Badge> : enabled ? <Badge variant="secondary">Enabled</Badge> : null}
                      <Badge variant="outline">
                        {provider.credentialType === "subscription" ? "Subscription" : provider.keyless ? "No key" : "API key"}
                      </Badge>
                    </div>
                    <CardDescription className="mt-1">
                      {provider.accountLabel ? `${provider.accountLabel} · ` : ""}
                      {provider.models.length} model{provider.models.length === 1 ? "" : "s"} available
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    {provider.credentialType === "subscription" ? (
                      <Button variant="outline" size="sm" onClick={() => { setSubscriptionProvider(provider.id); setDialog("subscription"); }}>Sign in again</Button>
                    ) : null}
                    <Button variant="ghost" size="icon" aria-label={`Remove ${provider.name}`} disabled={busy === `remove-${provider.id}`} onClick={() => void removeProvider(provider)}>
                      {busy === `remove-${provider.id}` ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center">
                  <Select value={selected} onValueChange={(value) => setSelectedModels((current) => ({ ...current, [provider.id]: value }))}>
                    <SelectTrigger className="w-full sm:max-w-md"><SelectValue placeholder="Choose a model" /></SelectTrigger>
                    <SelectContent>
                      {provider.models.map((model) => <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button disabled={!selected || active || busy === `use-${provider.id}`} onClick={() => void activateProvider(provider)}>
                    {busy === `use-${provider.id}` ? <Loader2 className="size-4 animate-spin" /> : <PlugZap className="size-4" />}
                    {active ? "In use" : "Use this provider"}
                  </Button>
                  {enabled && !active ? <Button variant="outline" onClick={() => void disableProvider(provider)}>Disable</Button> : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Connect a provider</h2>
          <p className="mt-1 text-sm text-muted-foreground">Choose how Youbot should access another AI service.</p>
        </div>
          <div className="provider-choice-grid grid gap-3">
          <ProviderChoice icon={LogIn} title="Sign in with a subscription" description="Use an eligible ChatGPT plan through OpenAI's official sign-in." action="Sign in" onClick={() => setDialog("subscription")} />
          <ProviderChoice icon={KeyRound} title="Add an API key" description="Connect a supported provider developer account." action="Add key" onClick={() => setDialog("api-key")} />
          <ProviderChoice icon={Server} title="Add a custom endpoint" description="Connect and verify an OpenAI-compatible service." action="Add endpoint" onClick={() => setDialog("custom")} />
        </div>
      </section>

      <Dialog open={dialog === "subscription"} onOpenChange={closeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sign in with ChatGPT</DialogTitle>
            <DialogDescription>ChatGPT subscription access is different from OpenAI API billing. OpenAI&apos;s official Codex runtime stores and refreshes the sign-in privately for Youbot.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Subscription provider</Label>
              <Select value={subscriptionProvider} onValueChange={setSubscriptionProvider} disabled={waiting}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{subscriptions.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {data?.message && waiting ? <p className="text-sm text-muted-foreground">{data.message}</p> : null}
            {data?.deviceCode ? <div className="rounded-lg border bg-muted/40 p-4"><p className="text-xs text-muted-foreground">Your code</p><p className="mt-1 font-mono text-xl font-semibold tracking-widest">{data.deviceCode}</p></div> : null}
            {data?.authUrl ? (
              <Button asChild className="w-full"><a href={data.authUrl} target="_blank" rel="noreferrer">Continue in browser <ExternalLink className="size-4" /></a></Button>
            ) : null}
            {data?.prompt ? (
              <div className="space-y-3 rounded-lg border p-4">
                <Label>{data.prompt.message}</Label>
                {data.prompt.options?.length ? (
                  <Select value={promptValue} onValueChange={setPromptValue}><SelectTrigger className="w-full"><SelectValue placeholder="Choose an option" /></SelectTrigger><SelectContent>{data.prompt.options.map((option) => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent></Select>
                ) : <Input value={promptValue} onChange={(event) => setPromptValue(event.target.value)} />}
                <Button disabled={!promptValue || busy === "prompt"} onClick={() => void respondToPrompt()}>Continue</Button>
              </div>
            ) : null}
            {!waiting ? <Button className="w-full" disabled={!subscriptionProvider || busy === "subscription"} onClick={() => void startSubscription()}>{busy === "subscription" ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}Sign in</Button> : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "api-key"} onOpenChange={closeDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add an API key</DialogTitle><DialogDescription>Developer API usage is charged separately from consumer subscriptions.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Provider</Label><Select value={keyProvider} onValueChange={setKeyProvider}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{keyProviders.map((provider) => <SelectItem key={provider.id} value={provider.id}>{provider.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label htmlFor="provider-key">API key</Label><Input id="provider-key" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Paste your API key" /></div>
            <div className="flex items-start gap-2 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0" />Stored privately by Youbot and never returned to this page.</div>
            <Button className="w-full" disabled={!apiKey.trim() || busy === "api-key"} onClick={() => void saveKey()}>{busy === "api-key" ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}Save API key</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "custom"} onOpenChange={closeDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add a custom endpoint</DialogTitle><DialogDescription>Use an OpenAI-compatible base URL. Public endpoints must use HTTPS; local, private-network, and Tailnet addresses may use HTTP.</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label htmlFor="custom-name">Name</Label><Input id="custom-name" value={customName} onChange={(event) => { setCustomName(event.target.value); setVerifiedModels(null); setCustomModel(""); }} placeholder="My local model" /></div>
            <div className="space-y-2"><Label htmlFor="custom-url">Base URL</Label><Input id="custom-url" value={customUrl} onChange={(event) => { setCustomUrl(event.target.value); setVerifiedModels(null); setCustomModel(""); }} placeholder="http://localhost:11434/v1" /></div>
            <div className="space-y-2"><Label htmlFor="custom-key">API key <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="custom-key" type="password" autoComplete="off" value={customKey} onChange={(event) => { setCustomKey(event.target.value); setVerifiedModels(null); setCustomModel(""); }} /></div>
            {verifiedModels ? <Alert><CheckCircle2 /><AlertDescription>Verified {verifiedModels.length} model{verifiedModels.length === 1 ? "" : "s"}.</AlertDescription></Alert> : null}
            {verifiedModels ? <div className="space-y-2"><Label>Model</Label><Select value={customModel} onValueChange={setCustomModel}><SelectTrigger className="w-full"><SelectValue placeholder="Choose a model" /></SelectTrigger><SelectContent>{verifiedModels.map((model) => <SelectItem key={model.id} value={model.id}>{model.name}</SelectItem>)}</SelectContent></Select><p className="text-xs leading-5 text-muted-foreground">Choose the model Youbot should use first.</p></div> : null}
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" disabled={!customName.trim() || !customUrl.trim() || busy === "verify-custom"} onClick={() => void verifyCustom()}>{busy === "verify-custom" ? <Loader2 className="size-4 animate-spin" /> : null}Verify</Button>
              <Button className="flex-1" disabled={!verifiedModels || !customModel || busy === "add-custom"} onClick={() => void addCustom()}>{busy === "add-custom" ? <Loader2 className="size-4 animate-spin" /> : <Server className="size-4" />}Add provider</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </StandardPage>
  );
}
