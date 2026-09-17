"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";

export type SlugState = "idle" | "checking" | "available" | "unavailable";

interface RelaySlugFieldProps {
  value: string;
  onChange: (value: string) => void;
  onStateChange?: (state: SlugState) => void;
  disabled?: boolean;
  currentSlug?: string;
}

function cleanSlug(value: string) {
  return value.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 40);
}

function localError(value: string) {
  if (!value) return "Choose a short address people will recognize.";
  if (value.length < 3) return "Use at least 3 characters.";
  if (!/^[a-z0-9](?:[a-z0-9]|-(?!-)){1,38}[a-z0-9]$/.test(value)) {
    return "Use letters, numbers, and single hyphens. Start and end with a letter or number.";
  }
  return "";
}

export function RelaySlugField({ value, onChange, onStateChange, disabled, currentSlug }: RelaySlugFieldProps) {
  const [state, setState] = useState<SlugState>("idle");
  const [message, setMessage] = useState("Choose a short address people will recognize.");

  useEffect(() => {
    const error = localError(value);
    if (error) {
      setState("idle");
      setMessage(error);
      onStateChange?.("idle");
      return;
    }
    if (currentSlug && value === currentSlug) {
      setState("available");
      setMessage("This is your relay address.");
      onStateChange?.("available");
      return;
    }

    setState("checking");
    setMessage("Checking availability…");
    onStateChange?.("checking");
    const timer = window.setTimeout(async () => {
      try {
        const result = await api<{ available: boolean; reason?: string }>(
          `/api/channels/webchat/relay/availability?slug=${encodeURIComponent(value)}`,
        );
        const next = result.available ? "available" : "unavailable";
        setState(next);
        setMessage(result.available ? "This address is available." : result.reason || "This address is unavailable.");
        onStateChange?.(next);
      } catch {
        setState("unavailable");
        setMessage("Availability could not be checked. Try again.");
        onStateChange?.("unavailable");
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [currentSlug, onStateChange, value]);

  return <div className="space-y-2">
    <Label htmlFor="relay-slug">Your public relay address</Label>
    <div className="flex h-10 overflow-hidden rounded-lg border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
      <span className="flex items-center border-r bg-muted/45 px-3 text-sm text-muted-foreground">youbot.live/</span>
      <Input
        id="relay-slug"
        value={value}
        onChange={(event) => onChange(cleanSlug(event.target.value))}
        disabled={disabled}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder="your-name"
        className="h-full rounded-none border-0 font-medium shadow-none focus-visible:ring-0"
        aria-describedby="relay-slug-status"
      />
      <span className="flex w-10 shrink-0 items-center justify-center" aria-hidden="true">
        {state === "checking" && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
        {state === "available" && <Check className="size-4 text-emerald-600" />}
        {state === "unavailable" && <X className="size-4 text-destructive" />}
      </span>
    </div>
    <p id="relay-slug-status" role="status" className={`text-xs ${state === "unavailable" ? "text-destructive" : "text-muted-foreground"}`}>
      {message}
    </p>
  </div>;
}
