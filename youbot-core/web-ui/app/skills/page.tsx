"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { RefreshCw, Trash2, FileCode2 } from "lucide-react";
import { StandardPage } from "@/components/workspace-frame";
import { ListToolbar } from "@/components/list-toolbar";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface Skill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  system?: boolean;
  trigger: {
    events: string[];
    condition?: string;
    filters?: {
      contacts?: string[];
      dmsOnly?: boolean;
      groupsOnly?: boolean;
      pattern?: string;
    };
  };
  processor: { instructions: string };
  outcome: { action: string };
  createdAt: string;
  updatedAt: string;
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [editSkill, setEditSkill] = useState<Skill | null>(null);
  const [rawContent, setRawContent] = useState<string>("");
  const [rawLoading, setRawLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("name");

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ skills: Skill[] }>("/api/skills");
      setSkills(data.skills || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const openEditor = async (skill: Skill) => {
    setEditSkill(skill);
    setRawLoading(true);
    try {
      const res = await fetch(`/api/skills/${skill.id}/raw`);
      if (res.ok) {
        setRawContent(await res.text());
      } else {
        // Fallback: synthesize frontmatter from skill object
        const filters = skill.trigger.filters || {};
        const filterLines: string[] = [];
        if (filters.contacts?.length) filterLines.push(`    contacts: [${filters.contacts.join(", ")}]`);
        if (filters.groupsOnly) filterLines.push(`    groupsOnly: true`);
        if (filters.dmsOnly) filterLines.push(`    dmsOnly: true`);
        const filtersBlock = filterLines.length ? `  filters:\n${filterLines.join("\n")}\n` : "";

        setRawContent(
          `---\nname: ${skill.name}\ndescription: ${skill.description}\ntriggers: [${skill.trigger.events.join(", ")}]\n${skill.trigger.condition ? `condition: "${skill.trigger.condition}"\n` : ""}outcome: ${skill.outcome.action}\n${filtersBlock}enabled: ${skill.enabled}\n---\n\n${skill.processor.instructions}`
        );
      }
    } catch {
      setRawContent("# Error loading skill file");
    } finally {
      setRawLoading(false);
    }
  };

  const toggleSkill = async (id: string, enabled: boolean) => {
    try {
      await api(`/api/skills/${id}`, { method: "PUT", body: { enabled } });
      setSkills((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
      toast.success(enabled ? "Skill enabled" : "Skill disabled");
    } catch {
      toast.error("Failed to update skill");
    }
  };

  const saveRaw = async () => {
    if (!editSkill) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/skills/${editSkill.id}/raw`, {
        method: "PUT",
        headers: { "Content-Type": "text/plain" },
        body: rawContent,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || "Save failed");
      }
      setEditSkill(null);
      loadSkills();
      toast.success("Skill saved");
    } catch (e: any) {
      toast.error(`Failed to save: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api(`/api/skills/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      loadSkills();
      toast.success("Skill deleted");
    } catch {
      toast.error("Failed to delete skill");
    } finally {
      setDeleting(false);
    }
  };

  const visibleSkills = skills
    .filter((skill) => {
      const matchesSearch = `${skill.name} ${skill.description} ${skill.trigger.events.join(" ")}`.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || (statusFilter === "enabled" ? skill.enabled : !skill.enabled);
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => sort === "recent" ? new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime() : a.name.localeCompare(b.name));

  return (
    <StandardPage title="Skills" description="Manage reusable instructions, triggers and outcomes for your agent." actions={<Button variant="outline" onClick={loadSkills}><RefreshCw className="size-4"/>Refresh</Button>}>
      <ListToolbar className="rounded-xl border bg-card" searchLabel="Search skills" searchPlaceholder="Search skills" searchValue={search} onSearchChange={setSearch} filters={[{label:"Skill status",value:statusFilter,onValueChange:setStatusFilter,options:[{value:"all",label:"All skills"},{value:"enabled",label:"Enabled"},{value:"disabled",label:"Disabled"}]}]} sort={{label:"Sort skills",value:sort,onValueChange:setSort,options:[{value:"name",label:"Name A–Z"},{value:"recent",label:"Recently updated"}]}} resultLabel={`${visibleSkills.length} of ${skills.length} skills`} active={!!search||statusFilter!=="all"||sort!=="name"} onReset={()=>{setSearch("");setStatusFilter("all");setSort("name");}} />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="hidden sm:table-cell">Description</TableHead>
                <TableHead className="hidden md:table-cell">Trigger</TableHead>
                <TableHead>Enabled</TableHead>
                <TableHead className="w-[100px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleSkills.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    {loading ? "Loading skills..." : skills.length ? "No skills match your search or filter." : "No skills configured. Add a skill through the supported skill management tools."}
                  </TableCell>
                </TableRow>
              ) : (
                visibleSkills.map((skill) => (
                  <TableRow key={skill.id}>
                    <TableCell className="font-medium font-mono text-sm">{skill.id}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground max-w-xs truncate sm:table-cell">
                      {skill.description}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        {skill.trigger.events?.map((e) => (
                          <Badge key={e} variant="secondary" className="text-xs font-mono">
                            {e}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={skill.enabled}
                        onCheckedChange={(v) => toggleSkill(skill.id, v)}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          title="Edit SKILL.md"
                          onClick={() => openEditor(skill)}
                        >
                          <FileCode2 className="size-4" />
                        </Button>
                        {!skill.system && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive"
                          onClick={() => setDeleteTarget(skill)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Skill</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Delete <strong>{deleteTarget?.id}</strong>? This removes the SKILL.md file permanently.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Raw Markdown Editor */}
      <Dialog open={!!editSkill} onOpenChange={(o) => !o && setEditSkill(null)}>
        <DialogContent className="max-w-3xl w-full h-[80vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 pt-6 pb-3 border-b">
            <DialogTitle className="flex items-center gap-2 font-mono text-base">
              <FileCode2 className="size-4 text-muted-foreground" />
              skills/{editSkill?.id}/SKILL.md
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-hidden flex flex-col">
            {rawLoading ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                Loading...
              </div>
            ) : (
              <textarea
                className="flex-1 w-full resize-none font-mono text-sm bg-muted/30 px-6 py-4 focus:outline-none border-0 leading-relaxed"
                value={rawContent}
                onChange={(e) => setRawContent(e.target.value)}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                data-gramm="false"
              />
            )}
          </div>

          <DialogFooter className="px-6 py-4 border-t">
            <p className="text-xs text-muted-foreground flex-1">
              Edit YAML frontmatter + markdown body. Save to update the skill file.
            </p>
            <Button variant="outline" onClick={() => setEditSkill(null)}>Cancel</Button>
            <Button onClick={saveRaw} disabled={saving || rawLoading}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StandardPage>
  );
}
