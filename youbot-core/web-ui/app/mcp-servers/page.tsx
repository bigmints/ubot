"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Plug,
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Wrench,
  Loader2,
  Zap,
  Search,
} from "lucide-react";
import { api } from "@/lib/api";
import { StandardPage } from "@/components/workspace-frame";
import { ListToolbar } from "@/components/list-toolbar";

import { toast } from "sonner";

// ─── Types ───────────────────────────────────────────────

interface McpToolInfo {
  name: string;
  description: string;
}

interface McpServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabledTools: string[];
  discoveredTools: McpToolInfo[];
  status: "connected" | "disconnected" | "error";
  error?: string;
  registeredToolCount: number;
}

// ─── Page ────────────────────────────────────────────────

export default function McpServersPage() {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("name");

  // Add dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [inputMode, setInputMode] = useState<"json" | "form">("json");
  // JSON mode
  const [jsonInput, setJsonInput] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  // Form mode
  const [addName, setAddName] = useState("");
  const [addCommand, setAddCommand] = useState("");
  const [addArgs, setAddArgs] = useState("");
  const [addEnv, setAddEnv] = useState("");
  // Shared
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(false);
  const [discoveredTools, setDiscoveredTools] = useState<McpToolInfo[]>([]);
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());
  const [validateError, setValidateError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const fetchServers = useCallback(async () => {
    try {
      const data = await api<{ servers: McpServer[] }>("/api/mcp/servers");
      setServers(data.servers);
    } catch {
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
    const interval = setInterval(fetchServers, 10000);
    return () => clearInterval(interval);
  }, [fetchServers]);

  // ── JSON Parsing ────────────────────────────────────────

  const JSON_PLACEHOLDER = `{
  "filesystem": {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    "env": {}
  }
}`;

  /**
   * Parse the standard mcpServers JSON config format.
   * Accepts either { "name": { command, args, env } }
   * or { "mcpServers": { "name": { command, args, env } } }
   */
  const parseJsonConfig = (
    raw: string
  ): { name: string; command: string; args: string[]; env: Record<string, string> } | null => {
    try {
      let parsed = JSON.parse(raw);

      // Unwrap if wrapped in mcpServers key
      if (parsed.mcpServers && typeof parsed.mcpServers === "object") {
        parsed = parsed.mcpServers;
      }

      const keys = Object.keys(parsed);
      if (keys.length === 0) {
        setJsonError("No server entries found");
        return null;
      }
      if (keys.length > 1) {
        setJsonError("Please add one server at a time");
        return null;
      }

      const name = keys[0];
      const config = parsed[name];

      if (!config.command || typeof config.command !== "string") {
        setJsonError(`"${name}.command" is required and must be a string`);
        return null;
      }

      setJsonError(null);
      return {
        name,
        command: config.command,
        args: Array.isArray(config.args) ? config.args.map(String) : [],
        env:
          config.env && typeof config.env === "object"
            ? Object.fromEntries(
                Object.entries(config.env).map(([k, v]) => [k, String(v)])
              )
            : {},
      };
    } catch (e: any) {
      setJsonError(e.message || "Invalid JSON");
      return null;
    }
  };

  // ── Helpers ──────────────────────────────────────────────

  const parseArgs = (s: string): string[] =>
    s
      .trim()
      .split(/\s+/)
      .filter(Boolean);

  const parseEnv = (s: string): Record<string, string> => {
    const env: Record<string, string> = {};
    for (const line of s.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
      }
    }
    return env;
  };

  const clearMessages = () => {
    setError(null);
    setSuccessMsg(null);
  };

  /**
   * Build the server config from the current input mode.
   */
  const getServerConfig = (): {
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
  } | null => {
    if (inputMode === "json") {
      return parseJsonConfig(jsonInput);
    }
    if (!addName.trim() || !addCommand.trim()) return null;
    return {
      name: addName.trim(),
      command: addCommand.trim(),
      args: parseArgs(addArgs),
      env: parseEnv(addEnv),
    };
  };

  const canValidate = (): boolean => {
    if (inputMode === "json") {
      return jsonInput.trim().length > 0;
    }
    return addCommand.trim().length > 0;
  };

  const canAdd = (): boolean => {
    if (!validated) return false;
    if (inputMode === "json") {
      return jsonInput.trim().length > 0 && !jsonError;
    }
    return addName.trim().length > 0 && addCommand.trim().length > 0;
  };

  // ── Validate ────────────────────────────────────────────

  const handleValidate = async () => {
    clearMessages();
    setValidating(true);
    setValidateError(null);
    setValidated(false);
    setDiscoveredTools([]);
    setSelectedTools(new Set());

    const config = getServerConfig();
    if (!config) {
      setValidating(false);
      return;
    }

    try {
      const data = await api<{
        valid: boolean;
        tools: McpToolInfo[];
        error?: string;
      }>("/api/mcp/servers/validate", {
        method: "POST",
        body: {
          command: config.command,
          args: config.args,
          env: config.env,
        },
      });

      if (data.valid) {
        setValidated(true);
        setDiscoveredTools(data.tools);
        setSelectedTools(new Set(data.tools.map((t) => t.name)));
      } else {
        setValidateError(data.error || "Validation failed");
      }
    } catch (err: any) {
      setValidateError(err.message);
    } finally {
      setValidating(false);
    }
  };

  // ── Add Server ──────────────────────────────────────────

  const handleAdd = async () => {
    clearMessages();
    setAdding(true);
    const config = getServerConfig();
    if (!config) {
      setAdding(false);
      return;
    }
    try {
      await api("/api/mcp/servers", {
        method: "POST",
        body: {
          name: config.name,
          command: config.command,
          args: config.args,
          env: config.env,
          enabledTools: [...selectedTools],
          discoveredTools,
          autoConnect: true,
        },
      });
      setSuccessMsg(`MCP server "${config.name}" added and connected!`);
      toast.success(`MCP server "${config.name}" added`);
      resetAddDialog();
      setAddOpen(false);
      fetchServers();
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setAdding(false);
    }
  };

  const resetAddDialog = () => {
    setInputMode("json");
    setJsonInput("");
    setJsonError(null);
    setAddName("");
    setAddCommand("");
    setAddArgs("");
    setAddEnv("");
    setValidated(false);
    setValidating(false);
    setDiscoveredTools([]);
    setSelectedTools(new Set());
    setValidateError(null);
  };

  // ── Delete ──────────────────────────────────────────────

  const handleDelete = async (id: string, name: string) => {
    clearMessages();
    try {
      await api(`/api/mcp/servers/${id}`, { method: "DELETE" });
      setSuccessMsg(`Removed "${name}".`);
      toast.success(`Removed "${name}"`);
      fetchServers();
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message);
    }
  };

  // ── Reconnect ───────────────────────────────────────────

  const handleReconnect = async (id: string) => {
    clearMessages();
    try {
      await api(`/api/mcp/servers/${id}/reconnect`, { method: "POST" });
      toast.success("Reconnecting...");
      fetchServers();
    } catch (err: any) {
      setError(err.message);
      toast.error(err.message);
    }
  };

  // ── Toggle Tool ─────────────────────────────────────────

  const handleToggleTool = async (
    server: McpServer,
    toolName: string,
    enabled: boolean
  ) => {
    clearMessages();
    const updated = enabled
      ? [...server.enabledTools, toolName]
      : server.enabledTools.filter((t) => t !== toolName);

    setServers((prev) =>
      prev.map((s) => (s.id === server.id ? { ...s, enabledTools: updated } : s))
    );

    try {
      await api(`/api/mcp/servers/${server.id}`, {
        method: "PUT",
        body: { enabledTools: updated },
      });
      fetchServers();
    } catch (err: any) {
      setError(err.message);
      fetchServers();
    }
  };

  // ── Status helpers ──────────────────────────────────────

  const statusColor = (s: McpServer["status"]) =>
    s === "connected"
      ? "bg-emerald-500"
      : s === "error"
        ? "bg-red-500"
        : "bg-muted-foreground";

  const statusText = (s: McpServer["status"]) =>
    s === "connected"
      ? "Connected"
      : s === "error"
        ? "Error"
        : "Disconnected";

  const visibleServers = servers
    .filter((server) => {
      const matchesSearch = `${server.name} ${server.command} ${server.discoveredTools.map((tool) => tool.name).join(" ")}`.toLowerCase().includes(search.toLowerCase());
      return matchesSearch && (statusFilter === "all" || server.status === statusFilter);
    })
    .sort((a, b) => sort === "tools" ? b.registeredToolCount - a.registeredToolCount : a.name.localeCompare(b.name));

  // ── Render ──────────────────────────────────────────────

  return (
    <StandardPage title="Tool connections" description="Connect external tool servers and manage what they make available." actions={
        <Dialog
          open={addOpen}
          onOpenChange={(open) => {
            setAddOpen(open);
            if (!open) resetAddDialog();
          }}
        >
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Add Server
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add MCP Server</DialogTitle>
              <DialogDescription>
                Paste the standard JSON config from any MCP server documentation,
                or fill in the form manually.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {/* Mode Toggle */}
              <div className="flex gap-1 p-1 rounded-lg bg-muted border">
                <button
                  onClick={() => { setInputMode("json"); setValidated(false); }}
                  className={`flex-1 text-sm py-1.5 px-3 rounded-md transition-all ${
                    inputMode === "json"
                      ? "bg-secondary text-foreground font-medium shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  JSON Config
                </button>
                <button
                  onClick={() => { setInputMode("form"); setValidated(false); }}
                  className={`flex-1 text-sm py-1.5 px-3 rounded-md transition-all ${
                    inputMode === "form"
                      ? "bg-secondary text-foreground font-medium shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Form
                </button>
              </div>

              {/* JSON Mode */}
              {inputMode === "json" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="mcp-json">Server Configuration</Label>
                    <span className="text-xs text-muted-foreground">
                      Claude Desktop / Cursor format
                    </span>
                  </div>
                  <Textarea
                    id="mcp-json"
                    placeholder={JSON_PLACEHOLDER}
                    value={jsonInput}
                    onChange={(e) => {
                      setJsonInput(e.target.value);
                      setValidated(false);
                      setJsonError(null);
                    }}
                    className="font-mono text-sm min-h-[180px]"
                    rows={8}
                  />
                  {jsonError && (
                    <p className="text-xs text-destructive flex items-center gap-1.5">
                      <XCircle className="h-3 w-3 shrink-0" />
                      {jsonError}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Accepts <code className="bg-muted px-1 py-0.5 rounded text-[11px]">{"{ \"name\": { command, args, env } }"}</code> or{" "}
                    <code className="bg-muted px-1 py-0.5 rounded text-[11px]">{"{ \"mcpServers\": { ... } }"}</code>
                  </p>
                </div>
              )}

              {/* Form Mode */}
              {inputMode === "form" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="mcp-name">Server Name</Label>
                    <Input
                      id="mcp-name"
                      placeholder="e.g. Filesystem, GitHub, Slack"
                      value={addName}
                      onChange={(e) => setAddName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mcp-command">Command</Label>
                    <Input
                      id="mcp-command"
                      placeholder="e.g. npx, node, python"
                      value={addCommand}
                      onChange={(e) => {
                        setAddCommand(e.target.value);
                        setValidated(false);
                      }}
                      className="font-mono text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mcp-args">Arguments</Label>
                    <Input
                      id="mcp-args"
                      placeholder="e.g. -y @modelcontextprotocol/server-filesystem /tmp"
                      value={addArgs}
                      onChange={(e) => {
                        setAddArgs(e.target.value);
                        setValidated(false);
                      }}
                      className="font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground">Space-separated</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="mcp-env">Environment Variables</Label>
                    <Textarea
                      id="mcp-env"
                      placeholder={"API_KEY=sk-...\nDEBUG=true"}
                      value={addEnv}
                      onChange={(e) => {
                        setAddEnv(e.target.value);
                        setValidated(false);
                      }}
                      className="font-mono text-sm"
                      rows={3}
                    />
                    <p className="text-xs text-muted-foreground">KEY=VALUE, one per line</p>
                  </div>
                </>
              )}

              {/* Validate Button */}
              <Button
                onClick={handleValidate}
                disabled={!canValidate() || validating}
                variant="outline"
                className="w-full gap-2"
              >
                {validating ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : validated ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                {validating
                  ? "Connecting & Discovering Tools..."
                  : validated
                    ? `${discoveredTools.length} Tools Discovered`
                    : "Validate & Discover Tools"}
              </Button>

              {/* Validate Error */}
              {validateError && (
                <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
                  <XCircle className="h-4 w-4 shrink-0" />
                  {validateError}
                </div>
              )}

              {/* Discovered Tools */}
              {validated && discoveredTools.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Select Tools to Enable</Label>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7"
                        onClick={() =>
                          setSelectedTools(
                            new Set(discoveredTools.map((t) => t.name))
                          )
                        }
                      >
                        All
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs h-7"
                        onClick={() => setSelectedTools(new Set())}
                      >
                        None
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto rounded-lg border p-3">
                    {discoveredTools.map((tool) => (
                      <div
                        key={tool.name}
                        className={`flex items-start gap-3 p-2.5 rounded-lg transition-all cursor-pointer ${
                          selectedTools.has(tool.name)
                            ? "bg-primary/10 border border-primary/20"
                            : "border border-transparent hover:bg-muted/50"
                        }`}
                        onClick={() => {
                          const next = new Set(selectedTools);
                          next.has(tool.name)
                            ? next.delete(tool.name)
                            : next.add(tool.name);
                          setSelectedTools(next);
                        }}
                      >
                        <Switch
                          checked={selectedTools.has(tool.name)}
                          onCheckedChange={(checked) => {
                            const next = new Set(selectedTools);
                            checked
                              ? next.add(tool.name)
                              : next.delete(tool.name);
                            setSelectedTools(next);
                          }}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-sm font-medium">
                            {tool.name}
                          </p>
                          {tool.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                              {tool.description}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {selectedTools.size} of {discoveredTools.length} tools
                    selected
                  </p>
                </div>
              )}

              {validated && discoveredTools.length === 0 && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 text-sm flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  Server connected but no tools were discovered.
                </div>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  setAddOpen(false);
                  resetAddDialog();
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleAdd}
                disabled={!canAdd() || adding}
                className="gap-2"
              >
                {adding ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Zap className="h-4 w-4" />
                )}
                {adding ? "Adding..." : "Add & Connect"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      }>

      <ListToolbar className="rounded-xl border bg-card" searchLabel="Search tool connections" searchPlaceholder="Search tool connections" searchValue={search} onSearchChange={setSearch} filters={[{label:"Connection status",value:statusFilter,onValueChange:setStatusFilter,options:[{value:"all",label:"All connections"},{value:"connected",label:"Connected"},{value:"disconnected",label:"Disconnected"},{value:"error",label:"Errors"}]}]} sort={{label:"Sort connections",value:sort,onValueChange:setSort,options:[{value:"name",label:"Name A–Z"},{value:"tools",label:"Most tools"}]}} resultLabel={`${visibleServers.length} of ${servers.length} connections`} active={!!search||statusFilter!=="all"||sort!=="name"} onReset={()=>{setSearch("");setStatusFilter("all");setSort("name");}} />

      {/* Alerts */}
      {error && (
        <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
          <XCircle className="size-4 shrink-0" />
          {error}
        </div>
      )}
      {successMsg && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-sm flex items-center gap-2">
          <CheckCircle2 className="size-4 shrink-0" />
          {successMsg}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty State */}
      {!loading && servers.length === 0 && (
        <EmptyState
          icon={<Plug className="size-8" />}
          title="No Tool connections"
          description="Add an MCP server to extend the agent with external tools. Popular options include filesystem, GitHub, databases, and more."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Your First Server
            </Button>
          }
        />
      )}

      {!loading && servers.length > 0 && visibleServers.length === 0 && (
        <EmptyState icon={<Search className="size-8" />} title="No matching tool connections" description="Try a different search or filter." />
      )}

      {/* Server Cards */}
      {visibleServers.map((server) => (
        <Card key={server.id}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Plug className="size-5 text-primary" />
                {server.name}
              </span>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1.5 font-mono text-xs">
                  <Wrench className="h-3 w-3" />
                  {server.registeredToolCount} tools
                </Badge>
                <Badge variant="outline" className="gap-1.5">
                  <span
                    className={`h-2 w-2 rounded-full ${statusColor(server.status)}`}
                  />
                  {statusText(server.status)}
                </Badge>
              </div>
            </CardTitle>
            <p className="text-xs font-mono text-muted-foreground">
              {server.command} {server.args.join(" ")}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Error */}
            {server.error && (
              <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
                <AlertTriangle className="size-4 shrink-0" />
                {server.error}
              </div>
            )}

            {/* Tools Grid */}
            {server.discoveredTools.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  Tools ({server.discoveredTools.length})
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {server.discoveredTools.map((tool) => {
                    const enabled =
                      server.enabledTools.length === 0 ||
                      server.enabledTools.includes(tool.name);
                    return (
                      <div
                        key={tool.name}
                        className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                          server.status !== "connected"
                            ? "opacity-50 border-border"
                            : enabled
                              ? "bg-primary/10 border-primary/20"
                              : "border-border bg-muted/30"
                        }`}
                      >
                        <div
                          className={`flex items-center justify-center h-8 w-8 rounded-lg shrink-0 ${
                            enabled && server.status === "connected"
                              ? "bg-primary/10"
                              : "bg-muted"
                          }`}
                        >
                          <Wrench
                            className={`h-4 w-4 ${
                              enabled && server.status === "connected"
                                ? "text-primary"
                                : "text-muted-foreground"
                            }`}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-mono text-xs font-medium truncate">
                            {tool.name}
                          </p>
                          {tool.description && (
                            <p className="text-xs text-muted-foreground truncate">
                              {tool.description}
                            </p>
                          )}
                        </div>
                        <Switch
                          checked={enabled}
                          onCheckedChange={(checked) =>
                            handleToggleTool(server, tool.name, checked)
                          }
                          disabled={server.status !== "connected"}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => handleReconnect(server.id)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Reconnect
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="gap-1.5"
                onClick={() => handleDelete(server.id, server.name)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remove
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </StandardPage>
  );
}
