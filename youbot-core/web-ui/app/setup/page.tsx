"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, Check, Loader2, Eye, EyeOff, ExternalLink, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { useSetup } from "@/hooks/use-setup";
import { useFeatures } from "@/hooks/use-features";
import { hasConfiguredModel, type ModelSettings } from "@/lib/setup";
import { RelaySlugField, type SlugState } from "@/components/relay-slug-field";
import { StandardPage } from "@/components/workspace-frame";

const choices = {
  gemini: { name: "Google Gemini", description: "Use an online AI service. You’ll need a Google AI key.", url: "https://generativelanguage.googleapis.com/v1beta/openai/", model: "gemini-2.5-flash" },
  ollama: { name: "Ollama on this machine", description: "Use AI you have already installed with Ollama.", url: "http://localhost:11434/v1", model: "" },
};

function SetupRelayAddress() {
  const [slug, setSlug] = useState("");
  const [savedSlug, setSavedSlug] = useState("");
  const [relayUrl, setRelayUrl] = useState("");
  const [state, setState] = useState<SlugState>("idle");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void api<{ webchatRelaySlug: string; webchatRelayUrl: string }>("/api/chat/config")
      .then(config => {
        setSavedSlug(config.webchatRelaySlug || "");
        setSlug(config.webchatRelaySlug || "");
        setRelayUrl(config.webchatRelayUrl || "");
      })
      .catch(() => setError("Your relay settings could not be loaded."));
  }, []);

  async function createRelay() {
    if (!slug || state !== "available") return;
    setSaving(true); setError("");
    try {
      const result = await api<{ slug: string; relayUrl: string }>("/api/channels/webchat/relay", {
        method: "POST",
        body: { requestedSlug: slug },
      });
      setSavedSlug(result.slug);
      setSlug(result.slug);
      setRelayUrl(result.relayUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your relay address could not be created.");
    } finally { setSaving(false); }
  }

  return <section className="space-y-4 rounded-xl border p-6">
    <div className="flex items-center gap-2 text-sm"><Globe className="size-4" />Website relay</div>
    {savedSlug ? <>
      <div className="flex items-center gap-2 text-sm text-emerald-700"><Check className="size-4" />Your relay address is ready</div>
      <a href={relayUrl} target="_blank" rel="noreferrer" className="block break-all text-lg font-semibold underline underline-offset-4">{relayUrl}</a>
      <p className="text-sm text-muted-foreground">Share this link with visitors, or add its chat widget to your website later.</p>
    </> : <>
      <div><h2 className="text-xl font-semibold">Choose your relay address</h2><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Reserve a simple youbot.live link for people who message your concierge.</p></div>
      <RelaySlugField value={slug} onChange={setSlug} onStateChange={setState} disabled={saving} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button onClick={() => void createRelay()} disabled={saving || state !== "available"}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Globe className="size-4" />}{saving ? "Creating address…" : "Reserve this address"}</Button>
    </>}
  </section>;
}

export default function SetupPage() {
  const { settings, loading, configured, error: loadError, refresh } = useSetup();
  const { features } = useFeatures();
  const [choice, setChoice] = useState<keyof typeof choices>("gemini");
  const [key, setKey] = useState("");
  const [model, setModel] = useState(choices.gemini.model);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving || !settings) return;
    setSaving(true); setError("");
    try {
      const existing = settings.providers[choice];
      const provider = { enabled: true, baseUrl: choices[choice].url, model: model.trim(), ...(choice === "gemini" ? { apiKey: key.trim() } : {}) };
      await api(existing ? `/api/integrations/models/${choice}` : "/api/integrations/models", { method: existing ? "PUT" : "POST", body: { ...provider, ...(!existing ? { key: choice } : {}) } });
      await api(`/api/integrations/models/${choice}/default`, { method: "PUT", body: {} });
      const readback = await api<ModelSettings>("/api/integrations/models");
      if (readback.default !== choice || readback.providers[choice]?.model !== model.trim() || !hasConfiguredModel(readback)) throw new Error("Settings did not match");
      setKey(""); setEditing(false);
      await refresh();
    } catch {
      setError("We couldn’t confirm your settings were saved. Your entries are still here. Try again, or open AI settings to check what was saved.");
    } finally { setSaving(false); }
  }

  const steps = ["Start Youbot", "Connect your AI", "Build your concierge", "Share your concierge"];
  return <StandardPage width="narrow" title="Setup guide" description="Connect the AI that helps your concierge understand and answer visitors.">
    <ol className="flex flex-wrap gap-x-6 gap-y-3 border-b pb-6" aria-label="Setup progress">{steps.map((step, i) => <li key={step} className="flex items-center gap-2 text-sm" aria-current={i === (configured ? 2 : 1) ? "step" : undefined}><span className="flex size-6 items-center justify-center rounded-full border text-xs">{i === 0 || (i === 1 && configured) ? <Check className="size-3.5" aria-label="Complete" /> : i + 1}</span>{step}</li>)}</ol>
    {loading ? <p role="status" className="flex gap-2 text-sm"><Loader2 className="size-4 animate-spin" />Checking your setup…</p> : loadError ? <div role="alert" className="space-y-3"><p>{loadError}</p><Button onClick={() => void refresh()} variant="outline">Try again</Button></div> : configured && !editing ? <section className="space-y-4 rounded-xl border p-6">
      <div className="flex items-center gap-2 text-sm"><Check className="size-4" />AI settings saved</div>
      <h2 className="text-xl font-semibold">Configure your agent profile</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">Your AI settings are saved. Next, tell your concierge how to help visitors, then connect a messaging app.</p>
      <div className="flex flex-wrap gap-3"><Button asChild><Link href="/concierge">Open agent profile <ArrowRight className="size-4" /></Link></Button><Button variant="ghost" onClick={() => setEditing(true)}>Change AI service</Button></div>
      <Link href="/llms" className="inline-block text-sm underline underline-offset-4">View all AI settings</Link>
    </section> : <form onSubmit={save} className="space-y-6">
      <fieldset disabled={saving} className="space-y-3"><legend className="mb-3 text-lg font-medium">Choose how Youbot thinks</legend>
        {(Object.entries(choices) as [keyof typeof choices, typeof choices.gemini][]).filter(([id]) => id !== "ollama" || features.ollama).map(([id, item]) => <label key={id} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${choice === id ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}><input type="radio" name="ai-service" value={id} checked={choice === id} onChange={() => { setChoice(id); setModel(item.model); setKey(""); setError(""); }} className="mt-1 accent-primary" /><span><span className="block text-sm font-medium">{item.name}</span><span className="mt-1 block text-sm text-muted-foreground">{item.description}</span></span></label>)}
      </fieldset>
      {choice === "gemini" ? <div className="space-y-4 rounded-xl border p-5">
        <h2 className="font-medium">Connect Google Gemini</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">An AI key is a private code that lets Youbot use your AI account. Treat it as a password and store it securely.</p>
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed"><li><a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-4">Open Google AI Studio <ExternalLink className="size-3" /></a> and create an API key.</li><li>Copy the key, then paste it below.</li></ol>
        <div className="space-y-2"><Label htmlFor="setup-key">Your Google AI key</Label><div className="flex gap-2"><Input id="setup-key" type={showKey ? "text" : "password"} value={key} onChange={e => setKey(e.target.value)} placeholder="Paste your key here" autoComplete="off" spellCheck={false} required disabled={saving} /><Button type="button" variant="outline" size="icon" aria-label={showKey ? "Hide AI key" : "Show AI key"} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button></div></div>
        <p className="text-xs leading-relaxed text-muted-foreground">Google’s availability, age requirements, free limits, and charges depend on your account and region. Review them before using the service. Your requests are sent to Google when you use this AI.</p>
        <details><summary className="cursor-pointer text-sm text-muted-foreground">More options</summary><div className="mt-3 space-y-2"><Label htmlFor="setup-cloud-model">AI model</Label><Input id="setup-cloud-model" value={model} onChange={e => setModel(e.target.value)} required disabled={saving} /><p className="text-xs text-muted-foreground">Change this only if you want a different model available to your account.</p></div></details>
      </div> : <div className="space-y-4 rounded-xl border p-5"><h2 className="font-medium">Use your installed AI</h2><p className="text-sm leading-relaxed text-muted-foreground"><a href="https://ollama.com" target="_blank" rel="noreferrer" className="underline underline-offset-4">Install and open Ollama</a>, then download a model that supports tools. Keep Ollama running on the same machine as Youbot.</p><div className="space-y-2"><Label htmlFor="setup-local-model">Name of your downloaded model</Label><Input id="setup-local-model" value={model} onChange={e => setModel(e.target.value)} placeholder="Copy the model name from Ollama" required disabled={saving} /></div><p className="text-xs text-muted-foreground">Local AI needs enough memory and can be slower. On a cloud server, “this machine” means that server, not your laptop. Use AI settings for a different server address.</p></div>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-4"><Button disabled={saving || !model.trim() || (choice === "gemini" && !key.trim())}>{saving ? <><Loader2 className="size-4 animate-spin" />Saving…</> : <>Save AI settings <ArrowRight className="size-4" /></>}</Button><Link href="/llms" className="text-sm underline underline-offset-4">Use another AI service</Link></div>
      <p className="text-xs text-muted-foreground">This saves your choice. After connecting a messaging app, check a visitor conversation to confirm replies work.</p>
    </form>}
    {configured && <SetupRelayAddress />}
    <section className="space-y-3 border-t pt-6"><h2 className="font-medium">After your first conversation</h2><p className="text-sm text-muted-foreground">You can connect apps, choose what Youbot is allowed to do, and set up routines whenever you’re ready.</p><div className="flex flex-wrap gap-5 text-sm"><Link className="underline underline-offset-4" href="/connections">Connect an app</Link><Link className="underline underline-offset-4" href="/safety">Review permissions</Link><Link className="underline underline-offset-4" href="/help">Installation & help</Link></div></section>
  </StandardPage>;
}
