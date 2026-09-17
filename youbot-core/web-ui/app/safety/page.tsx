"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw } from "lucide-react";
import { StandardPage } from "@/components/workspace-frame";
import { ListToolbar } from "@/components/list-toolbar";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface SafetyRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  type: string;
  pattern: string;
  action: string;
}

export default function SafetyPage() {
  const [rules, setRules] = useState<SafetyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("name");

  const loadRules = async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await api<{ rules: SafetyRule[] }>("/api/safety/rules");
      setRules(data.rules || []);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Permissions could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRules();
  }, []);

  const toggleRule = async (id: string, enabled: boolean) => {
    try {
      await api(`/api/safety/rules/${id}`, {
        method: "PUT",
        body: { enabled },
      });
      setRules((prev) =>
        prev.map((r) => (r.id === id ? { ...r, enabled } : r))
      );
      toast.success(enabled ? "Rule enabled" : "Rule disabled");
    } catch {
      toast.error("Failed to update rule");
    }
  };

  const visibleRules = rules
    .filter((rule) => {
      const matchesSearch = `${rule.name} ${rule.description} ${rule.action}`.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || (statusFilter === "enabled" ? rule.enabled : !rule.enabled);
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => sort === "action" ? a.action.localeCompare(b.action) : a.name.localeCompare(b.name));

  return (
    <StandardPage title="Permissions" description="Set safety rules and review the actions your agent is allowed to perform." actions={<Button variant="outline" onClick={loadRules}><RefreshCw className="size-4"/>Refresh</Button>}>

      {loadError && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{loadError} Use Refresh to try again.</p>}
      <ListToolbar className="rounded-xl border bg-card" searchLabel="Search permissions" searchPlaceholder="Search permissions" searchValue={search} onSearchChange={setSearch} filters={[{label:"Permission status",value:statusFilter,onValueChange:setStatusFilter,options:[{value:"all",label:"All permissions"},{value:"enabled",label:"Enabled"},{value:"disabled",label:"Disabled"}]}]} sort={{label:"Sort permissions",value:sort,onValueChange:setSort,options:[{value:"name",label:"Name A–Z"},{value:"action",label:"Action A–Z"}]}} resultLabel={`${visibleRules.length} of ${rules.length} permissions`} active={!!search||statusFilter!=="all"||sort!=="name"} onReset={()=>{setSearch("");setStatusFilter("all");setSort("name");}} />
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rule</TableHead>
                <TableHead className="hidden sm:table-cell">Action</TableHead>
                <TableHead>Enabled</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadError ? <TableRow><TableCell colSpan={3} className="p-6 text-center text-muted-foreground">Rules are unavailable.</TableCell></TableRow> : visibleRules.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-muted-foreground py-8"
                  >
                    {loading ? "Loading rules..." : rules.length ? "No permissions match your search or filter." : "No safety rules configured"}
                  </TableCell>
                </TableRow>
              ) : (
                visibleRules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="hidden sm:table-cell">
                      <div>
                        <p className="font-medium">{rule.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {rule.description}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          rule.action === "block" ? "destructive" : "secondary"
                        }
                      >
                        {rule.action}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={(v) => toggleRule(rule.id, v)}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </StandardPage>
  );
}
