"use client";

import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, Save, RefreshCw, Check, ChevronRight } from "lucide-react";

// ── Core Route Names ────────────────────────────────────

const coreRouteNames: Record<string, string> = {
  "/": "Overview",
  "/setup": "Setup guide",
  "/help": "Help",
  "/connections": "Connections",
  "/chat": "Conversations",
  "/concierge": "Agent profile",
  "/concierge/collections": "Collections",
  "/conversations": "Conversations",
  "/skills": "Skills",
  "/whatsapp": "WhatsApp",
  "/telegram": "Telegram",
  "/safety": "Permissions",
  "/scheduler": "Automations",
  "/settings": "Settings",
  "/settings/ai-providers": "AI providers",
  "/llms": "AI providers",
  "/web-search": "Web Search",
  "/cli": "CLI Agents",
  "/google": "Google Apps",
  "/mcp-servers": "Tool connections",
  "/tools": "System status",
  "/logs": "Activity logs",
  "/vault": "Secure storage",
  "/agents": "Agents",
  "/personas": "Profile documents",
  "/contacts": "Contacts",
  "/agent-defaults": "Agent Defaults",
  "/approvals": "Approvals",
  "/webchat": "Website chat",
  "/apple": "Apple Services",
  "/profile": "User profile",
  "/integrations": "Apps & services",
};

// ── Extension Points ────────────────────────────────────

const extRouteNames: Record<string, string> = {};
const extFeatureRoutes: { prefix: string; label: string; listHref: string }[] = [];
const extTopBarWidgets: Array<() => React.ReactNode> = [];

/**
 * Register additional route names for breadcrumbs.
 */
export function registerBreadcrumbRoutes(routes: Record<string, string>): void {
  Object.assign(extRouteNames, routes);
}

/**
 * Register feature routes for hierarchical breadcrumbs.
 * e.g., { prefix: '/myapp/contacts', label: 'Contacts', listHref: '/myapp/contacts' }
 */
export function registerFeatureRoutes(routes: { prefix: string; label: string; listHref: string }[]): void {
  extFeatureRoutes.push(...routes);
}

/**
 * Register additional widgets to show in the top bar (e.g., app switcher).
 */
export function registerTopBarWidget(widget: () => React.ReactNode): void {
  extTopBarWidgets.push(widget);
}

// ── Top Bar Actions ─────────────────────────────────────

interface TopBarActions {
  onSave?: () => void;
  onDelete?: () => void;
  saving?: boolean;
  saved?: boolean;
}

// Global action state — pages can register their actions
let _actions: TopBarActions = {};
let _listeners: (() => void)[] = [];

export function setTopBarActions(actions: TopBarActions) {
  _actions = actions;
  _listeners.forEach((fn) => fn());
}

export function clearTopBarActions() {
  _actions = {};
  _listeners.forEach((fn) => fn());
}

function useTopBarActions(): TopBarActions {
  const [actions, setActions] = useState<TopBarActions>({});
  useEffect(() => {
    const update = () => setActions({ ..._actions });
    _listeners.push(update);
    update();
    return () => {
      _listeners = _listeners.filter((fn) => fn !== update);
    };
  }, []);
  return actions;
}

// ── Detail Name ─────────────────────────────────────────

let _detailName = "";
const _detailListeners: (() => void)[] = [];

export function setTopBarDetailName(name: string) {
  _detailName = name;
  _detailListeners.forEach((fn) => fn());
  _listeners.forEach((fn) => fn());
}

export function clearTopBarDetailName() {
  _detailName = "";
  _detailListeners.forEach((fn) => fn());
  _listeners.forEach((fn) => fn());
}

// ── Component ───────────────────────────────────────────

export function PageBreadcrumb() {
  const pathname = usePathname();
  const actions = useTopBarActions();
  const [detailName, setDetailName] = useState(_detailName);

  useEffect(() => {
    const updateDetailName = () => setDetailName(_detailName);
    _detailListeners.push(updateDetailName);
    updateDetailName();
    return () => {
      const index = _detailListeners.indexOf(updateDetailName);
      if (index >= 0) _detailListeners.splice(index, 1);
    };
  }, []);

  const handleClearChat = () => {
    window.dispatchEvent(new CustomEvent("youbot:clear-chat"));
  };

  // All route names (core + extensions)
  const routeNames = { ...coreRouteNames, ...extRouteNames };

  // Check if this is a feature detail page
  const featureRoute = extFeatureRoutes.find((r) => pathname?.startsWith(r.prefix));
  const isDetailPage =
    featureRoute &&
    pathname !== featureRoute.listHref &&
    pathname !== `${featureRoute.listHref}/new`;

  // Build breadcrumb segments
  const breadcrumb: { label: string; href?: string }[] = [];

  if (featureRoute) {
    breadcrumb.push({ label: featureRoute.label, href: featureRoute.listHref });

    if (pathname === `${featureRoute.listHref}/new`) {
      breadcrumb.push({ label: "New" });
    } else if (isDetailPage) {
      breadcrumb.push({ label: _detailName || "..." });
    }
  }

  const staticName = routeNames[pathname || ""];

  if (!featureRoute && staticName) {
    if (pathname?.startsWith("/settings/")) {
      breadcrumb.push({ label: "Settings", href: "/settings" });
    }
    breadcrumb.push({ label: staticName, href: detailName ? pathname || undefined : undefined });
    if (detailName) breadcrumb.push({ label: detailName });
  }

  return (
    <div className="flex items-center justify-between flex-1 min-w-0">
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5">
        {breadcrumb.length > 0 ? (
          breadcrumb.map((seg, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && (
                <ChevronRight className="size-3 text-muted-foreground" />
              )}
              {seg.href ? (
                <a
                  href={seg.href}
                  className="font-medium text-sm text-muted-foreground hover:text-foreground transition"
                >
                  {seg.label}
                </a>
              ) : i === breadcrumb.length - 1 ? (
                <h1 className="truncate text-sm font-semibold">{seg.label}</h1>
              ) : (
                <span className="font-medium text-sm">{seg.label}</span>
              )}
            </span>
          ))
        ) : (
          <h1 className="truncate text-sm font-semibold">
            {staticName || "Youbot"}
          </h1>
        )}
      </nav>

      <div className="flex items-center gap-1.5">
        {/* Extension widgets (e.g., app switcher) */}
        {extTopBarWidgets.map((Widget, i) => (
          <Widget key={i} />
        ))}

        {/* Feature page actions (Save/Delete) */}
        {actions.onDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive h-7 px-2 text-xs"
            onClick={actions.onDelete}
          >
            <Trash2 className="size-3.5 mr-1" /> Delete
          </Button>
        )}
        {actions.onSave && (
          <Button
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={actions.onSave}
            disabled={actions.saving}
          >
            {actions.saved ? (
              <>
                <Check className="size-3.5 mr-1" /> Saved
              </>
            ) : actions.saving ? (
              <>
                <RefreshCw className="size-3.5 mr-1 animate-spin" /> Saving...
              </>
            ) : (
              <>
                <Save className="size-3.5 mr-1" /> Save
              </>
            )}
          </Button>
        )}

        {/* Chat-specific clear button */}
        {pathname === "/legacy-chat" && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={handleClearChat}
            title="Clear chat history"
          >
            <Trash2 className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
