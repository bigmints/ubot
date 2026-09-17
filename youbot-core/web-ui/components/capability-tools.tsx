"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RefreshCw, Wrench, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

// ── Capability → Tool Module Mapping ──

const CAPABILITY_MODULES: Record<string, string[]> = {
  models: ["messaging"],
  search: ["web-search"],
  cli: ["cli"],

  google: ["google"],
  apple: ["apple"],
  mcp: [], // dynamic — mcp:* modules
  browser: ["browser"],
  memory: ["memory"],
  vault: ["vault"],
  media: ["media"],
  skills: ["skills"],
  scheduler: ["scheduler"],
  approvals: ["approvals"],
};

interface ToolHealthStatus {
  module: string;
  tool: {
    name: string;
    description: string;
    parameters: Array<{ name: string; type: string; description: string; required: boolean }>;
  };
  status: "active" | "disconnected" | "error";
  message: string;
}

interface CapabilityToolsProps {
  /** The capability key from config, e.g. "models", "cli", "search" */
  capability: string;
  /** Optional override for which modules to show */
  modules?: string[];
}

function StatusDot({ status }: { status: string }) {
  switch (status) {
    case "active":
      return (
        <div className="flex items-center gap-1.5">
          <div className="size-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
          <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">Active</span>
        </div>
      );
    case "disconnected":
      return (
        <div className="flex items-center gap-1.5">
          <div className="size-1.5 rounded-full bg-amber-500" />
          <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">Offline</span>
        </div>
      );
    case "error":
      return (
        <div className="flex items-center gap-1.5">
          <div className="size-1.5 rounded-full bg-red-500" />
          <span className="text-[11px] font-medium text-red-600 dark:text-red-400">Error</span>
        </div>
      );
    default:
      return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
  }
}

export function CapabilityTools({ capability, modules }: CapabilityToolsProps) {
  const [tools, setTools] = useState<ToolHealthStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [toggling, setToggling] = useState(false);

  // Fallback to the capability string itself for dynamically loaded custom modules
  const targetModules = modules || CAPABILITY_MODULES[capability] || [capability];

  const loadTools = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ tools: ToolHealthStatus[] }>("/api/tools");
      const all = data.tools || [];

      // Filter to only tools belonging to this capability's modules
      const filtered = all.filter((t) => {
        if (capability === "mcp") return t.module.startsWith("mcp:");
        // Check exact match or custom:<module> syntax
        return targetModules.includes(t.module) || targetModules.includes(t.module.replace('custom:', ''));
      });

      setTools(filtered);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [capability, targetModules]);

  const loadEnabled = useCallback(async () => {
    try {
      const data = await api<{ cli?: any }>("/api/config/integrations");
      // For now, capabilities are always enabled — future: read from capabilities.<name>.enabled
    } catch {
      /* ignore */
    }
  }, [capability]);

  useEffect(() => {
    loadTools();
  }, [loadTools]);

  const activeCount = tools.filter((t) => t.status === "active").length;
  const totalCount = tools.length;

  if (totalCount === 0 && !loading) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Wrench className="size-4" />
            Associated Tools
          </CardTitle>
          <div className="flex items-center gap-2">
            {!loading && (
              <Badge variant="outline" className="text-xs gap-1.5">
                <div
                  className={`size-1.5 rounded-full ${
                    activeCount === totalCount
                      ? "bg-emerald-500"
                      : activeCount > 0
                        ? "bg-amber-500"
                        : "bg-red-500"
                  }`}
                />
                {activeCount}/{totalCount} active
              </Badge>
            )}
            <Button variant="ghost" size="icon" className="size-7" onClick={loadTools}>
              <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <TooltipProvider>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-muted/30">
                <TableHead className="w-[200px] font-semibold text-foreground/80">Tool</TableHead>
                <TableHead className="font-semibold text-foreground/80">Description</TableHead>
                <TableHead className="w-[80px] font-semibold text-foreground/80">Health</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    <RefreshCw className="size-4 animate-spin inline mr-2" />
                    Loading tools...
                  </TableCell>
                </TableRow>
              ) : tools.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                    No tools registered for this capability
                  </TableCell>
                </TableRow>
              ) : (
                tools.map((item) => (
                  <TableRow key={item.tool.name} className="border-muted/20">
                    <TableCell className="font-mono font-medium text-xs text-primary/90">
                      {item.tool.name}
                    </TableCell>
                    <TableCell className="max-w-[300px]">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="truncate text-sm text-muted-foreground/90 cursor-help transition-colors hover:text-foreground">
                            {item.tool.description}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-xs p-3">
                          <p className="text-sm leading-relaxed">{item.tool.description}</p>
                          {item.message && item.message !== "Available" && (
                            <p className="text-xs text-muted-foreground mt-1">{item.message}</p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <StatusDot status={item.status} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TooltipProvider>
      </CardContent>
    </Card>
  );
}
