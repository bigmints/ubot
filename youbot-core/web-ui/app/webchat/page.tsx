"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Globe,
  Wifi,
  WifiOff,
  RefreshCw,
  Save,
  Copy,
  Check,
  ExternalLink,
  Code,
  Palette,
  BotMessageSquare,
} from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { RelaySlugField, type SlugState } from "@/components/relay-slug-field";
import { StandardPage } from "@/components/workspace-frame";

interface ChatConfig {
  autoReplyWebchat: boolean;
  webchatEnabled: boolean;
  webchatToken: string;
  webchatRelayUrl: string;
  webchatRelaySlug: string;
  webchatBotSecret: string;
  webchatOwnerKey: string;
  webchatWidgetTitle: string;
  webchatWidgetColor: string;
  webchatWelcomeMessage: string;
  webchatAvatarUrl: string;
}

interface WebchatStatus {
  status: string;
  relayUrl: string;
  error: string;
}

export default function WebchatPage() {
  const [config, setConfig] = useState<ChatConfig | null>(null);
  const [connStatus, setConnStatus] = useState<WebchatStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [relaySlug, setRelaySlug] = useState("");
  const [slugState, setSlugState] = useState<SlugState>("idle");

  const loadConfig = useCallback(async () => {
    try {
      const data = await api<ChatConfig>("/api/chat/config");
      setConfig(data);
      setRelaySlug(data.webchatRelaySlug || "");
    } catch { /* ignore */ }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await api<WebchatStatus>("/api/webchat/status");
      setConnStatus(data);
    } catch {
      setConnStatus({ status: "unknown", relayUrl: "", error: "" });
    }
  }, []);

  useEffect(() => {
    loadConfig();
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [loadConfig, fetchStatus]);

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await api("/api/chat/config", { method: "PUT", body: config });
      if (config.webchatRelayUrl) {
        await api("/api/channels/webchat/relay", { method: "POST" });
        await fetchStatus();
      }
      toast.success("Website chat settings saved.");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const createFreeRelay = async () => {
    if (slugState !== "available" || !relaySlug) return;
    setProvisioning(true);
    try {
      const result = await api<{ relayUrl: string }>("/api/channels/webchat/relay", {
        method: "POST",
        body: { requestedSlug: relaySlug },
      });
      await loadConfig();
      await fetchStatus();
      toast.success("Your free relay link is ready.");
      if (result.relayUrl) await navigator.clipboard.writeText(result.relayUrl).catch(() => {});
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Free relay could not be created");
    } finally {
      setProvisioning(false);
    }
  };

  const updateField = (field: keyof ChatConfig, value: unknown) => {
    if (!config) return;
    setConfig({ ...config, [field]: value });
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      toast.success(`${label} copied to clipboard`);
      setTimeout(() => setCopied(null), 2000);
    } catch { toast.error("Failed to copy"); }
  };

  const relayUrl = config?.webchatRelayUrl || "";
  const embedSnippet = relayUrl
    ? `<script src="${relayUrl}/widget.js"\n        data-server="${relayUrl}"></script>`
    : "";

  const status = connStatus?.status || "unknown";
  const isConnected = status === "connected";
  const isConnecting = status === "connecting";
  const statusColor = isConnected
    ? "bg-emerald-500"
    : isConnecting
      ? "bg-amber-500"
      : "bg-muted-foreground";

  return (
    <StandardPage title="Website chat" description="Share your concierge with a link or add it to your website.">

      {/* Connection Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              {isConnected ? (
                <Wifi className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <WifiOff className="h-5 w-5 text-muted-foreground" />
              )}
              Your relay link
            </span>
            <Badge variant="outline" className="gap-1.5">
              <span className={`h-2 w-2 rounded-full ${statusColor}`} />
              {status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {relayUrl && (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <Globe className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="font-medium text-emerald-700 dark:text-emerald-300">
                  {isConnected ? "Ready to receive messages" : "Relay link created"}
                </p>
                <p className="text-sm text-muted-foreground break-all">{relayUrl}</p>
              </div>
            </div>
          )}

          {connStatus?.error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {connStatus.error}
            </div>
          )}

          {!config?.webchatRelaySlug && (
            <div className="space-y-4 rounded-xl border bg-muted/20 p-5">
              <div>
                <p className="text-sm font-medium">Choose your free relay address</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">This is the link you can share with visitors. Your computer must be running for the concierge to reply.</p>
              </div>
              <RelaySlugField value={relaySlug} onChange={setRelaySlug} onStateChange={setSlugState} disabled={provisioning} />
              <Button onClick={createFreeRelay} disabled={provisioning || slugState !== "available"}>
                {provisioning ? <RefreshCw className="size-4 animate-spin" /> : <Globe className="size-4" />}
                {provisioning ? "Creating address…" : relayUrl ? "Use this address" : "Create relay address"}
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Website chat</Label>
              <p className="text-xs text-muted-foreground">Allow visitors to message your concierge.</p>
            </div>
            <Switch
              checked={config?.webchatEnabled ?? true}
              onCheckedChange={(v) => updateField("webchatEnabled", v)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Auto-Reply */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BotMessageSquare className="h-5 w-5" />
            Concierge replies
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="wc-auto-reply">Reply automatically</Label>
              <p className="text-xs text-muted-foreground">
                Let your concierge respond to new website messages.
              </p>
            </div>
            <Switch
              id="wc-auto-reply"
              checked={config?.autoReplyWebchat ?? true}
              onCheckedChange={(v) => updateField("autoReplyWebchat", v)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Widget Customization */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Palette className="h-5 w-5" />
            Widget Customization
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Display Name</label>
            <Input
              value={config?.webchatWidgetTitle || ""}
              onChange={(e) => updateField("webchatWidgetTitle", e.target.value)}
              placeholder="Connect with us"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Brand Color</label>
            <div className="flex items-center gap-2">
              <Input
                value={config?.webchatWidgetColor || "#6366f1"}
                onChange={(e) => updateField("webchatWidgetColor", e.target.value)}
                placeholder="#6366f1"
                className="flex-1"
              />
              <div
                className="size-9 rounded-md border shrink-0"
                style={{ backgroundColor: config?.webchatWidgetColor || "#6366f1" }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Logo / Avatar URL</label>
            <div className="flex items-center gap-2">
              <Input
                value={config?.webchatAvatarUrl || ""}
                onChange={(e) => updateField("webchatAvatarUrl", e.target.value)}
                placeholder="https://example.com/logo.png"
                className="flex-1"
              />
              {config?.webchatAvatarUrl && (
                <div className="size-9 rounded-full border overflow-hidden shrink-0">
                  <img src={config.webchatAvatarUrl} alt="Logo" className="w-full h-full object-cover" />
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Welcome Message</label>
            <Textarea
              value={config?.webchatWelcomeMessage || ""}
              onChange={(e) => updateField("webchatWelcomeMessage", e.target.value)}
              placeholder="Hi there! How can I help you today?"
              rows={2}
            />
          </div>
        </CardContent>
      </Card>

      {/* Embed Code */}
      {relayUrl && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Code className="h-5 w-5" />
              Embed Code
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <pre className="bg-muted rounded-md p-4 text-sm font-mono overflow-x-auto whitespace-pre-wrap break-all">
                {embedSnippet}
              </pre>
              <Button
                variant="outline"
                size="sm"
                className="absolute top-2 right-2"
                onClick={() => copyToClipboard(embedSnippet, "Embed")}
              >
                {copied === "Embed" ? <Check className="size-3 mr-1" /> : <Copy className="size-3 mr-1" />}
                {copied === "Embed" ? "Copied" : "Copy"}
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Input readOnly value={relayUrl} className="font-mono text-sm flex-1" />
              <Button variant="outline" size="icon" onClick={() => copyToClipboard(relayUrl, "URL")}>
                {copied === "URL" ? <Check className="size-4" /> : <Copy className="size-4" />}
              </Button>
              <Button variant="outline" size="icon" asChild>
                <a href={relayUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="size-4" />
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Save */}
      <Button onClick={saveConfig} disabled={saving} className="gap-2">
        {saving ? <RefreshCw className="size-4 animate-spin" /> : <Save className="size-4" />}
        {saving ? "Saving..." : "Save Settings"}
      </Button>
    </StandardPage>
  );
}
