"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ChevronDown,
  FileText,
  KeyRound,
  Moon,
  Monitor,
  Save,
  ScrollText,
  Sun,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useTheme, type Theme } from "@/components/theme-provider";
import { FormSection, FormFeedback } from "@/components/page-header";
import { StandardPage } from "@/components/workspace-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { conciergeApi } from "@/lib/concierge";

interface Preferences { settings: { maxHistoryMessages: number }; revision: string }
interface SettingLink { href: string; title: string; description: string; icon: LucideIcon }

const profileLinks: SettingLink[] = [
  { href: "/profile", title: "User profile", description: "Your details and the context your concierge should know.", icon: UserRound },
  { href: "/personas", title: "Profile documents", description: "Extra reference material and instructions.", icon: FileText },
  { href: "/vault", title: "Secure storage", description: "Credentials and protected documents.", icon: KeyRound },
];
const advancedLinks: SettingLink[] = [
  { href: "/tools", title: "System status", description: "Check the availability of tools and services.", icon: Activity },
  { href: "/logs", title: "Activity logs", description: "Review detailed events for troubleshooting.", icon: ScrollText },
];

function SettingsLinks({ items }: { items: SettingLink[] }) {
  return (
    <div className="divide-y border-y">
      {items.map((item) => (
        <Link key={item.href} href={item.href} className="group flex items-center gap-4 px-1 py-5 transition-colors hover:bg-muted/50 sm:px-3">
          <item.icon className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium">{item.title}</span>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">{item.description}</span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
        </Link>
      ))}
    </div>
  );
}

export default function Settings() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [data, setData] = useState<Preferences | null>(null);
  const [value, setValue] = useState("20");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const result = await conciergeApi<Preferences>("/workspace-settings");
      setData(result);
      setValue(String(result.settings.maxHistoryMessages));
      setError("");
    } catch (caught) {
      setError((caught as Error).message);
    }
  }

  useEffect(() => { setMounted(true); void load(); }, []);

  async function save() {
    if (!data || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await conciergeApi<Preferences>("/workspace-settings", {
        settings: { maxHistoryMessages: Number(value) },
        revision: data.revision,
      }, "PUT");
      setData(saved);
      setValue(String(saved.settings.maxHistoryMessages));
      setNotice("Conversation preference saved.");
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <StandardPage title="Settings" description="Manage the AI service and a small set of workspace preferences.">
      <FormFeedback error={error} notice={notice} />
      {error && <Button variant="outline" onClick={() => void load()}>Reload preferences</Button>}

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <FormSection title="Appearance" description="Choose how Youbot looks in this browser.">
          <div className="grid grid-cols-3 gap-3">
            {[
              { id: "light", label: "Light", icon: Sun },
              { id: "dark", label: "Dark", icon: Moon },
              { id: "system", label: "System", icon: Monitor },
            ].map((option) => (
              <button key={option.id} onClick={() => setTheme(option.id as Theme)} aria-pressed={mounted && theme === option.id} className={`flex flex-col items-center gap-3 rounded-xl border p-4 text-sm ${mounted && theme === option.id ? "border-primary bg-primary/5 font-medium text-primary" : "hover:bg-muted"}`}>
                <option.icon className="size-5" />{option.label}
              </button>
            ))}
          </div>
        </FormSection>

        <FormSection title="Conversation context" description="Choose how much recent conversation history the agent considers.">
          <label className="block space-y-2">
            <span className="text-sm font-medium">Recent messages</span>
            <div className="flex flex-wrap gap-3">
              <Input className="w-28" type="number" min={5} max={200} value={value} disabled={!data || busy} onChange={(event) => setValue(event.target.value)} />
              <Button variant="outline" disabled={!data || busy || Number(value) === data.settings.maxHistoryMessages || !Number.isInteger(Number(value)) || Number(value) < 5 || Number(value) > 200} onClick={() => void save()}>
                <Save className="size-4" />{busy ? "Saving…" : "Save"}
              </Button>
            </div>
            <span className="block text-xs leading-5 text-muted-foreground">Between 5 and 200 messages. More context can increase AI usage.</span>
          </label>
        </FormSection>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Profile & data</h2>
          <p className="mt-1 text-sm text-muted-foreground">Information your concierge uses and protected items it can access.</p>
        </div>
        <SettingsLinks items={profileLinks} />
      </section>

      <details className="group rounded-xl border bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
          Advanced and troubleshooting
        </summary>
        <div className="px-5 pb-5"><SettingsLinks items={advancedLinks} /></div>
      </details>
    </StandardPage>
  );
}
