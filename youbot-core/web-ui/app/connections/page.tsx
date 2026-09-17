"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Blocks, Globe, MessageCircle, Plug, Send, type LucideIcon } from "lucide-react";
import { StandardPage } from "@/components/workspace-frame";
import { api } from "@/lib/api";
import { useFeatures } from "@/hooks/use-features";

interface ConnectionItem {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  enabled: boolean;
  status?: boolean;
}

export default function ConnectionsPage() {
  const { features } = useFeatures();
  const [statuses, setStatuses] = useState<Record<string, string>>({});

  useEffect(() => {
    let live = true;
    async function refresh() {
      const keys = ["whatsapp", "telegram", "webchat"].filter((key) => features[key]);
      const values = await Promise.all(keys.map(async (key) => {
        try {
          const data = await api<{ status: string; autoReply?: boolean }>(`/api/${key}/status`);
          const label = data.status === "connected"
            ? (data.autoReply === false ? "Connected · automatic replies off" : "Connected")
            : "Not connected";
          return [`/${key}`, label];
        } catch {
          return [`/${key}`, "Could not check connection"];
        }
      }));
      if (live) setStatuses(Object.fromEntries(values));
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    return () => { live = false; clearInterval(timer); };
  }, [features]);

  const channels: ConnectionItem[] = [
    { title: "WhatsApp", description: "Let people reach your concierge through WhatsApp.", href: "/whatsapp", icon: MessageCircle, enabled: features.whatsapp, status: true },
    { title: "Telegram", description: "Connect a Telegram bot for visitor conversations.", href: "/telegram", icon: Send, enabled: features.telegram, status: true },
    { title: "Website chat", description: "Add your concierge to a website or share its relay link.", href: "/webchat", icon: Globe, enabled: features.webchat, status: true },
  ];
  const tools: ConnectionItem[] = [
    { title: "Apps & tools", description: "Connect calendars, files, and services your concierge can use.", href: "/integrations", icon: Blocks, enabled: true },
    { title: "Custom tool servers", description: "Connect specialist tools through an MCP server.", href: "/mcp-servers", icon: Plug, enabled: features.mcp },
  ];

  const renderItems = (items: ConnectionItem[]) => (
    <div className="connection-directory divide-y border-y">
      {items.filter((item) => item.enabled).map((item) => (
        <Link key={item.href} href={item.href} className="group flex items-center gap-5 px-1 py-6 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring sm:px-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-background">
            <item.icon className="size-4 text-foreground" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-medium">{item.title}</span>
              {item.status && <span className="text-xs font-medium text-muted-foreground">{statuses[item.href] || "Checking…"}</span>}
            </span>
            <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">{item.description}</span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
        </Link>
      ))}
    </div>
  );

  return (
    <StandardPage className="signature-connections" title="Connections" description="Choose where people can message your concierge and what it can use to help them.">
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Visitor channels</h2>
          <p className="mt-1 text-sm text-muted-foreground">Places where conversations with visitors begin.</p>
        </div>
        {renderItems(channels)}
      </section>
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold">Apps & tools</h2>
          <p className="mt-1 text-sm text-muted-foreground">Services your concierge can use while helping people.</p>
        </div>
        {renderItems(tools)}
      </section>
    </StandardPage>
  );
}
