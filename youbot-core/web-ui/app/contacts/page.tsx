"use client";

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, User, Users, Save, RefreshCw, Brain, Trash2, Check, Plus, Database, Eye, Pencil } from "lucide-react";
import { WorkspacePage } from "@/components/workspace-frame";
import { ListToolbar } from "@/components/list-toolbar";
import { api } from "@/lib/api";
import { toast } from "sonner";

const CodeMirror = dynamic(() => import("@uiw/react-codemirror"), { ssr: false });
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";

const BOT_SOUL_ID = "__bot__";
const OWNER_SOUL_ID = "__owner__";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PersonaSummary {
  id: string;
  label: string;
  updatedAt: string;
  contentLength: number;
  type?: 'core' | 'agent';
}

interface MemoryEntry {
  id: string;
  contactId: string;
  category: string;
  key: string;
  value: string;
  source: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Document Editor (persona YAML)                                     */
/* ------------------------------------------------------------------ */

function DocumentEditor({
  personaId,
  label,
  description,
  readOnly = false,
}: {
  personaId: string;
  label: string;
  description: string;
  readOnly?: boolean;
}) {
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ content: string }>(
        `/api/personas/${encodeURIComponent(personaId)}`
      );
      setContent(data.content || "");
      setSavedContent(data.content || "");
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api(`/api/personas/${encodeURIComponent(personaId)}`, {
        method: "PUT",
        body: { content },
      });
      setSavedContent(content);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
      toast.success("Persona saved");
    } catch {
      toast.error("Failed to save persona");
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = content !== savedContent;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">{label}</CardTitle>
            <CardDescription className="mt-1">{description}</CardDescription>
          </div>
          <div className="flex gap-2 items-center">
            {hasChanges && (
              <Badge variant="outline" className="text-yellow-600 dark:text-yellow-500 border-yellow-500/50">
                Unsaved changes
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`size-4 mr-1 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            {!readOnly && (
              <Button
                size="sm"
                onClick={handleSave}
                disabled={saving || !hasChanges}
              >
                {justSaved ? (
                  <><Check className="size-4 mr-1" /> Saved</>
                ) : (
                  <><Save className="size-4 mr-1" /> Save</>
                )}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center text-muted-foreground py-8">Loading...</div>
        ) : (
          <div className="w-full overflow-hidden rounded-md">
            <CodeMirror
              value={content}
              onChange={(val) => !readOnly && setContent(val)}
              extensions={[markdown({ codeLanguages: languages }), EditorView.lineWrapping]}
              theme={oneDark}
              readOnly={readOnly}
              minHeight="300px"
              maxHeight="600px"
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
                bracketMatching: true,
              }}
              style={{ width: "100%" }}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Profile Details (structured key-value data from agent_memories)    */
/* ------------------------------------------------------------------ */

const CATEGORIES = [
  { value: "identity", label: "Identity" },
  { value: "preference", label: "Preference" },
  { value: "fact", label: "Fact" },
  { value: "relationship", label: "Relationship" },
  { value: "note", label: "Note" },
];

function ProfileDetails({ contactId, title }: { contactId: string; title?: string }) {
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newCategory, setNewCategory] = useState("identity");
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ memories: MemoryEntry[] }>(
        `/api/memories/${encodeURIComponent(contactId)}`
      );
      // Filter out summary entries — those are internal
      setMemories((data.memories || []).filter(m => m.category !== "summary"));
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [contactId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim()) return;
    setAdding(true);
    try {
      await api("/api/memories", {
        method: "POST",
        body: {
          contactId,
          category: newCategory,
          key: newKey.trim(),
          value: newValue.trim(),
          source: "manual",
        },
      });
      setNewKey("");
      setNewValue("");
      await load();
      toast.success("Memory added");
    } catch {
      toast.error("Failed to add memory");
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api(`/api/memories/${encodeURIComponent(id)}`, { method: "DELETE" });
      setMemories(prev => prev.filter(m => m.id !== id));
      toast.success("Memory deleted");
    } catch {
      toast.error("Failed to delete memory");
    }
  };

  // Group memories by category
  const grouped = memories.reduce<Record<string, MemoryEntry[]>>((acc, m) => {
    if (!acc[m.category]) acc[m.category] = [];
    acc[m.category].push(m);
    return acc;
  }, {});

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="size-4" />
              {title || "Profile Details"}
            </CardTitle>
            <CardDescription className="mt-1">
              Structured data — name, phone, email, etc. Automatically extracted + manually editable.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`size-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="text-center text-muted-foreground py-6">Loading...</div>
        ) : (
          <>
            {/* Existing memories grouped by category */}
            {Object.keys(grouped).length === 0 && (
              <div className="text-center text-muted-foreground py-6">
                <Database className="size-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No profile details yet. Add some below or they&apos;ll be extracted from conversations.</p>
              </div>
            )}

            {Object.entries(grouped).map(([category, items]) => (
              <div key={category}>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  {category}
                </h4>
                <div className="space-y-1">
                  {items.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between py-1.5 px-3 rounded-md hover:bg-muted/50 group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-sm font-medium text-muted-foreground w-28 shrink-0 truncate">
                          {m.key}
                        </span>
                        <span className="text-sm truncate">{m.value}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge
                          variant="outline"
                          className="text-[10px] opacity-60"
                        >
                          {m.source}
                        </Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-6 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
                          onClick={() => handleDelete(m.id)}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* Add new entry */}
            <Separator />
            <div className="flex items-end gap-2">
              <div className="w-32">
                <label className="text-xs text-muted-foreground mb-1 block">Category</label>
                <Select value={newCategory} onValueChange={setNewCategory}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">Key</label>
                <Input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="e.g. name, email, company"
                  className="h-9"
                />
              </div>
              <div className="flex-[2]">
                <label className="text-xs text-muted-foreground mb-1 block">Value</label>
                <Input
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="e.g. John Doe"
                  className="h-9"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAdd();
                  }}
                />
              </div>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={adding || !newKey.trim() || !newValue.trim()}
                className="h-9"
              >
                <Plus className="size-4 mr-1" />
                Add
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Owner Profile Fields (parsed from SOUL.md YAML headers)            */
/* ------------------------------------------------------------------ */

const OWNER_FIELD_ORDER = [
  "name", "title", "location", "phone", "email",
  "linkedin", "website", "blog", "appointments", "company",
];

function OwnerProfileFields() {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [savedFields, setSavedFields] = useState<Record<string, string>>({});
  const [rawDoc, setRawDoc] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  /** Parse key: value lines from the # Owner Profile section */
  const parseFields = (content: string): Record<string, string> => {
    const result: Record<string, string> = {};
    const lines = content.split("\n");
    let inOwnerSection = false;

    for (const line of lines) {
      if (line.startsWith("# Owner Profile")) {
        inOwnerSection = true;
        continue;
      }
      if (inOwnerSection && line.startsWith("# ")) break; // next section
      if (!inOwnerSection) continue;

      const match = line.match(/^([a-zA-Z_]+)\s*:\s*(.+)$/);
      if (match) {
        result[match[1].trim()] = match[2].trim();
      }
    }
    return result;
  };

  /** Rebuild the Owner Profile YAML section in the document */
  const rebuildDoc = (doc: string, updatedFields: Record<string, string>): string => {
    const lines = doc.split("\n");
    const newLines: string[] = [];
    let inOwnerSection = false;
    let pastOwnerFields = false;

    for (const line of lines) {
      if (line.startsWith("# Owner Profile")) {
        inOwnerSection = true;
        newLines.push(line);
        // Insert all fields after the header
        const orderedKeys = [
          ...OWNER_FIELD_ORDER.filter(k => k in updatedFields),
          ...Object.keys(updatedFields).filter(k => !OWNER_FIELD_ORDER.includes(k)),
        ];
        for (const key of orderedKeys) {
          newLines.push(`${key}: ${updatedFields[key]}`);
        }
        continue;
      }
      if (inOwnerSection && !pastOwnerFields) {
        if (line.startsWith("# ") || line.trim() === "") {
          pastOwnerFields = true;
          if (line.trim() === "") {
            newLines.push(line);
            continue;
          }
        } else {
          // Skip old key: value lines — we already wrote the new ones
          const isKV = line.match(/^[a-zA-Z_]+\s*:\s*.+$/);
          if (isKV) continue;
          pastOwnerFields = true;
        }
      }
      newLines.push(line);
    }
    return newLines.join("\n");
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ content: string }>(
        `/api/personas/${encodeURIComponent(OWNER_SOUL_ID)}`
      );
      const content = data.content || "";
      setRawDoc(content);
      const parsed = parseFields(content);
      setFields(parsed);
      setSavedFields(parsed);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const hasChanges = JSON.stringify(fields) !== JSON.stringify(savedFields);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updatedDoc = rebuildDoc(rawDoc, fields);
      await api(`/api/personas/${encodeURIComponent(OWNER_SOUL_ID)}`, {
        method: "PUT",
        body: { content: updatedDoc },
      });
      setRawDoc(updatedDoc);
      setSavedFields({ ...fields });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
      toast.success("Profile fields saved to SOUL.md");
    } catch {
      toast.error("Failed to save profile fields");
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = () => {
    if (!newKey.trim() || !newValue.trim()) return;
    setFields(prev => ({ ...prev, [newKey.trim()]: newValue.trim() }));
    setNewKey("");
    setNewValue("");
  };

  const handleRemove = (key: string) => {
    setFields(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const orderedKeys = [
    ...OWNER_FIELD_ORDER.filter(k => k in fields),
    ...Object.keys(fields).filter(k => !OWNER_FIELD_ORDER.includes(k)),
  ];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Database className="size-4" />
              Profile Fields
            </CardTitle>
            <CardDescription className="mt-1">
              Structured fields stored as YAML headers in SOUL.md. Editable below.
            </CardDescription>
          </div>
          <div className="flex gap-2 items-center">
            {hasChanges && (
              <Badge variant="outline" className="text-yellow-600 dark:text-yellow-500 border-yellow-500/50">
                Unsaved
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={load} disabled={loading}>
              <RefreshCw className={`size-4 mr-1 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || !hasChanges}
            >
              {justSaved ? (
                <><Check className="size-4 mr-1" /> Saved</>
              ) : (
                <><Save className="size-4 mr-1" /> Save</>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="text-center text-muted-foreground py-6">Loading...</div>
        ) : (
          <>
            {orderedKeys.length === 0 && (
              <div className="text-center text-muted-foreground py-6">
                <Database className="size-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No profile fields yet. Add fields below — they&apos;ll be saved as YAML headers in SOUL.md.</p>
              </div>
            )}

            {orderedKeys.map((key) => (
              <div key={key} className="flex items-center gap-3 group">
                <span className="text-sm font-medium text-muted-foreground w-28 shrink-0 truncate">
                  {key}
                </span>
                <Input
                  value={fields[key]}
                  onChange={(e) =>
                    setFields(prev => ({ ...prev, [key]: e.target.value }))
                  }
                  className="h-9 flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive shrink-0"
                  onClick={() => handleRemove(key)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}

            <Separator />
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground mb-1 block">Key</label>
                <Input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="e.g. twitter, timezone"
                  className="h-9"
                />
              </div>
              <div className="flex-[2]">
                <label className="text-xs text-muted-foreground mb-1 block">Value</label>
                <Input
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="e.g. @pretheeshmt"
                  className="h-9"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAdd();
                  }}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleAdd}
                disabled={!newKey.trim() || !newValue.trim()}
                className="h-9"
              >
                <Plus className="size-4 mr-1" />
                Add
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Personas Table                                                     */
/* ------------------------------------------------------------------ */

function PersonasTable({ 
  filter, 
  emptyTitle, 
  emptyDescription, 
  icon: Icon,
  showTypeBadge = false,
}: { 
  filter: (p: PersonaSummary) => boolean;
  emptyTitle: string;
  emptyDescription: string;
  icon: any;
  showTypeBadge?: boolean;
}) {
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ personas: PersonaSummary[] }>("/api/personas");
      setPersonas((data.personas || []).filter(filter));
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async (personaId: string) => {
    try {
      await api(`/api/personas/${encodeURIComponent(personaId)}`, {
        method: "DELETE",
      });
      setPersonas((prev) => prev.filter((p) => p.id !== personaId));
      if (selected === personaId) setSelected(null);
      toast.success("Persona deleted");
    } catch {
      toast.error("Failed to delete persona");
    }
  };

  if (loading) {
    return <div className="text-center text-muted-foreground py-8">Loading...</div>;
  }

  if (personas.length === 0 && !selected) {
    return (
      <div className="text-center text-muted-foreground py-12 border rounded-lg border-dashed">
        <Icon className="size-10 mx-auto mb-3 opacity-40" />
        <p className="font-medium">{emptyTitle}</p>
        <p className="text-sm mt-1">{emptyDescription}</p>
      </div>
    );
  }

  if (selected) {
    const persona = personas.find((p) => p.id === selected);
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
          ← Back to list
        </Button>
        <DocumentEditor
          personaId={selected}
          label={`${persona?.label || selected} — Persona`}
          description="Personality traits, communication style, and relationship context"
        />
        {persona?.type !== 'agent' && (
          <ProfileDetails
            contactId={selected}
            title={`${persona?.label || selected} — Details`}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {personas.length} item{personas.length !== 1 ? "s" : ""} found
        </p>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="size-4 mr-1" />
          Refresh
        </Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                {showTypeBadge && <TableHead>Type</TableHead>}
                <TableHead>Size</TableHead>
                <TableHead>Last Updated</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {personas.map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer group"
                  onClick={() => setSelected(p.id)}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="bg-muted rounded-full size-8 flex items-center justify-center shrink-0">
                        <Icon className="size-4" />
                      </div>
                      <span className="font-medium truncate">{p.label}</span>
                    </div>
                  </TableCell>
                  {showTypeBadge && (
                    <TableCell>
                      {p.type === 'agent' && (
                        <Badge variant="secondary" className="text-[10px] h-4 px-1">AGENT</Badge>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="text-muted-foreground">
                    {p.contentLength > 0 ? `${p.contentLength} chars` : 'File-based'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(p.id);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function ContactsTable() {
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [memoriesByContact, setMemoriesByContact] = useState<Record<string, MemoryEntry[]>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("recent");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [personaData, memData] = await Promise.all([
        api<{ personas: PersonaSummary[] }>("/api/personas"),
        api<{ memoriesByContact: Record<string, MemoryEntry[]> }>("/api/memories"),
      ]);
      setPersonas(
        (personaData.personas || []).filter(
          (p) => p.type === "core" && p.id !== BOT_SOUL_ID && p.id !== OWNER_SOUL_ID
        )
      );
      setMemoriesByContact(memData.memoriesByContact || {});
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Extract a specific field from a contact's memories */
  const getField = (contactId: string, key: string): string | undefined => {
    const memories = memoriesByContact[contactId];
    if (!memories) return undefined;
    const entry = memories.find(
      (m) => m.key.toLowerCase() === key.toLowerCase() && m.category !== "summary"
    );
    return entry?.value;
  };

  /** Build a display name: prefer extracted "name", fallback to label */
  const getDisplayName = (p: PersonaSummary): string => {
    const name = getField(p.id, "name") || getField(p.id, "full_name") || getField(p.id, "display_name");
    return name || p.label;
  };

  /** Get phone number(s) — the id itself is often a phone number */
  const getPhone = (p: PersonaSummary): string => {
    const phone = getField(p.id, "phone") || getField(p.id, "phone_number");
    if (phone) return phone;
    // LIDs are internal WhatsApp identifiers, not phone numbers
    if (p.id.includes("@lid")) return "—";
    // The persona ID is often a phone number like +1234567890
    const idDigits = p.id.replace(/[^0-9+]/g, "");
    if (idDigits.length >= 8) return idDigits.startsWith("+") ? idDigits : `+${idDigits}`;
    return "—";
  };

  const handleDelete = async (personaId: string) => {
    try {
      await api(`/api/personas/${encodeURIComponent(personaId)}`, {
        method: "DELETE",
      });
      setPersonas((prev) => prev.filter((p) => p.id !== personaId));
      if (selected === personaId) setSelected(null);
      toast.success("Contact deleted");
    } catch {
      toast.error("Failed to delete contact");
    }
  };

  const visiblePersonas = personas
    .filter((persona) => {
      const phone = getPhone(persona);
      const company = getField(persona.id, "company") || getField(persona.id, "organization") || "";
      if (filter === "phone" && phone === "—") return false;
      if (filter === "organization" && !company) return false;
      const query = search.trim().toLocaleLowerCase();
      if (!query) return true;
      return [getDisplayName(persona), phone, company, persona.id]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query);
    })
    .sort((left, right) => {
      if (sort === "name") return getDisplayName(left).localeCompare(getDisplayName(right), undefined, { sensitivity: "base" });
      if (sort === "name-desc") return getDisplayName(right).localeCompare(getDisplayName(left), undefined, { sensitivity: "base" });
      const difference = Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "");
      return Number.isNaN(difference) ? 0 : difference;
    });

  if (loading) {
    return <div className="text-center text-muted-foreground py-8">Loading...</div>;
  }

  const selectedPersona = personas.find((p) => p.id === selected);
  return (
    <div className="workspace-columns contact-workspace">
      <aside aria-label="Contact list" className={`${selected ? "hidden lg:flex" : "flex"} workspace-rail`}>
        <div className="flex h-14 items-center justify-between border-b px-4">
          <p className="text-sm font-medium">{personas.length} contact{personas.length !== 1 ? "s" : ""}</p>
          <Button variant="ghost" size="icon" onClick={load} aria-label="Refresh contacts">
            <RefreshCw className="size-4" />
          </Button>
        </div>
        <ListToolbar
          searchLabel="Search contacts"
          searchPlaceholder="Search contacts"
          searchValue={search}
          onSearchChange={setSearch}
          filters={[{
            label: "Contact filter",
            value: filter,
            onValueChange: setFilter,
            options: [
              { value: "all", label: "All contacts" },
              { value: "phone", label: "With phone" },
              { value: "organization", label: "With organization" },
            ],
          }]}
          sort={{
            label: "Sort contacts",
            value: sort,
            onValueChange: setSort,
            options: [
              { value: "recent", label: "Recently updated" },
              { value: "name", label: "Name A–Z" },
              { value: "name-desc", label: "Name Z–A" },
            ],
          }}
          resultLabel={`${visiblePersonas.length} of ${personas.length} contacts`}
          active={!!search || filter !== "all" || sort !== "recent"}
          onReset={() => { setSearch(""); setFilter("all"); setSort("recent"); }}
        />
        <div className="flex-1 overflow-y-auto">
          {visiblePersonas.length === 0 ? (
            <div className="space-y-2 p-6 text-sm text-muted-foreground">
              <User className="size-6" />
              <p className="font-medium text-foreground">{personas.length ? "No matching contacts" : "No contact profiles yet"}</p>
              <p>{personas.length ? "Try another search or filter." : "Contact profiles are created from conversations."}</p>
            </div>
          ) : visiblePersonas.map((p) => {
            const displayName = getDisplayName(p);
            const phone = getPhone(p);
            const company = getField(p.id, "company") || getField(p.id, "organization");
            return (
              <button
                key={p.id}
                aria-current={selected === p.id ? "true" : undefined}
                onClick={() => setSelected(p.id)}
                className="group flex w-full gap-3 border-b p-4 text-left transition-colors hover:bg-muted/60 aria-[current=true]:border-l-2 aria-[current=true]:border-l-primary aria-[current=true]:bg-card"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted"><User className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{displayName}</span>
                  <span className="mt-1 block truncate text-xs text-muted-foreground">{company || phone}</span>
                  <span className="mt-2 block text-[11px] text-muted-foreground">Updated {p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : "—"}</span>
                </span>
              </button>
            );
          })}
        </div>
      </aside>
      <section aria-label="Contact details" className={`${selected ? "flex" : "hidden lg:flex"} workspace-canvas flex-col`}>
        {!selected || !selectedPersona ? (
          <div className="m-auto max-w-sm p-8 text-center">
            <Users className="mx-auto size-8 text-muted-foreground" />
            <h2 className="mt-4 text-lg font-semibold">Select a contact</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Review their profile and the details your concierge has gathered.</p>
          </div>
        ) : (
          <>
            <header className="flex min-h-14 items-center gap-3 border-b px-4">
              <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setSelected(null)}>← Contacts</Button>
              <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{getDisplayName(selectedPersona)}</h2><p className="truncate text-xs text-muted-foreground">{getPhone(selectedPersona)}</p></div>
              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" aria-label="Delete contact" onClick={() => void handleDelete(selectedPersona.id)}><Trash2 className="size-4" /></Button>
            </header>
            <div className="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
              <DocumentEditor personaId={selected} label={`${getDisplayName(selectedPersona)} — Persona`} description="Personality traits, communication style, and relationship context" />
              <ProfileDetails contactId={selected} title={`${getDisplayName(selectedPersona)} — Details`} />
            </div>
          </>
        )}
      </section>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function ContactsPage() {
  return (
    <WorkspacePage className="signature-contacts" title="Contacts" description="Manage visitor identities, contact details and information gathered from conversations.">
      <ContactsTable />
    </WorkspacePage>
  );
}
