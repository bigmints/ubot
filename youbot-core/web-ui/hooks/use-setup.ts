"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { hasConfiguredModel, type ModelSettings } from "@/lib/setup";

export function useSetup() {
  const [settings, setSettings] = useState<ModelSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api<ModelSettings>("/api/integrations/models");
      if (!data.providers || typeof data.default !== "string") throw new Error("Invalid response");
      setSettings(data);
    } catch {
      setError("We couldn’t check your AI settings. Check that Youbot is still running, then try again.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  return { settings, loading, error, refresh, configured: !!settings && hasConfiguredModel(settings) };
}
