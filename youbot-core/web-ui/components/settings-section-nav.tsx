"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BrainCircuit, SlidersHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";

const sections = [
  { href: "/settings", label: "General", icon: SlidersHorizontal },
  { href: "/settings/ai-providers", label: "AI & models", icon: BrainCircuit },
];

export function SettingsSectionNav({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  if (mobile) {
    return (
      <label className="block space-y-2">
        <span className="text-xs font-medium text-muted-foreground">Settings section</span>
        <select
          aria-label="Settings section"
          className="h-11 w-full rounded-lg border bg-card px-3 text-sm"
          value={pathname}
          onChange={(event) => router.push(event.target.value)}
        >
          {sections.map((section) => (
            <option key={section.href} value={section.href}>{section.label}</option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <nav aria-label="Settings sections" className="settings-section-list flex flex-col gap-1 p-3">
      {sections.map((section) => {
        const active = pathname === section.href;
        return (
          <Link
            key={section.href}
            href={section.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-w-0 items-center gap-3 rounded-lg px-3 py-3 text-sm transition-colors",
              active
                ? "bg-primary/10 font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <section.icon className="size-4 shrink-0" />
            <span className="truncate">{section.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
