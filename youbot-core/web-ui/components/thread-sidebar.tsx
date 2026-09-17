"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus,
  MessageSquare,
  Pencil,
  Trash2,
  MoreVertical,
  PanelLeftClose,
  PanelLeft,
  Filter,
  Globe,
  Smartphone,
  Send,
  MessageCircle,
  Loader2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface Thread {
  id: string;
  type: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface ThreadSidebarProps {
  activeThreadId: string;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
}

type ChannelFilter = "all" | "web" | "whatsapp" | "telegram";

const CHANNEL_CONFIG: Record<string, { icon: typeof MessageSquare; label: string; color: string }> = {
  web: { icon: Globe, label: "Web", color: "text-blue-600 dark:text-blue-500" },
  whatsapp: { icon: Smartphone, label: "WhatsApp", color: "text-green-600 dark:text-green-500" },
  telegram: { icon: Send, label: "Telegram", color: "text-sky-600 dark:text-sky-500" },

};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ThreadSidebar({
  activeThreadId,
  onSelectThread,
  onNewThread,
}: ThreadSidebarProps) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>("all");
  const [processingIds, setProcessingIds] = useState<string[]>([]);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [initDone, setInitDone] = useState(false);
  const [readTimestamps, setReadTimestamps] = useState<Record<string, number>>({});

  const loadThreads = async () => {
    try {
      const data = await api<{ sessions: Thread[] }>("/api/chat/sessions");
      setThreads(data.sessions || []);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    loadThreads();
  }, [activeThreadId]);

  // Load and initialize read timestamps
  useEffect(() => {
    if (initDone || threads.length === 0) return;
    try {
      const stored = localStorage.getItem('youbot_thread_read_timestamps');
      if (stored) {
        setReadTimestamps(JSON.parse(stored));
      } else {
        // Initial setup - consider all currently loaded threads as read to avoid spamming dots on first load
        const initialMap: Record<string, number> = {};
        threads.forEach(t => {
          initialMap[t.id] = new Date(t.updatedAt).getTime();
        });
        setReadTimestamps(initialMap);
        localStorage.setItem('youbot_thread_read_timestamps', JSON.stringify(initialMap));
      }
    } catch {}
    setInitDone(true);
  }, [threads, initDone]);

  // Update read timestamp when a thread becomes active
  useEffect(() => {
    if (!activeThreadId || threads.length === 0 || !initDone) return;
    const activeThread = threads.find(t => t.id === activeThreadId);
    if (!activeThread) return;
    
    const activeTime = new Date(activeThread.updatedAt).getTime();
    setReadTimestamps(prev => {
      const prevTime = prev[activeThreadId] || 0;
      if (activeTime > prevTime) {
        const next = { ...prev, [activeThreadId]: activeTime };
        try {
          localStorage.setItem('youbot_thread_read_timestamps', JSON.stringify(next));
        } catch {}
        return next;
      }
      return prev;
    });
  }, [activeThreadId, threads, initDone]);

  // Poll for processing status to show typing indicators
  useEffect(() => {
    const poll = async () => {
      try {
        const data = await api<{ sessions: string[] }>("/api/chat/processing");
        setProcessingIds(data.sessions || []);
      } catch { /* ignore */ }
    };
    poll();
    const interval = setInterval(poll, 1500);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const handleRename = async (threadId: string) => {
    if (!renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    try {
      await api("/api/chat/sessions", {
        method: "PUT",
        body: { sessionId: threadId, name: renameValue.trim() },
      });
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId ? { ...t, name: renameValue.trim() } : t
        )
      );
      toast.success("Thread renamed");
    } catch {
      toast.error("Failed to rename thread");
    }
    setRenamingId(null);
  };

  const handleDelete = async (threadId: string) => {
    try {
      await api("/api/chat/sessions/delete", {
        method: "POST",
        body: { sessionId: threadId },
      });
      setThreads((prev) => prev.filter((t) => t.id !== threadId));
      toast.success("Thread deleted");
      // If we deleted the active thread, select another or create new
      if (threadId === activeThreadId) {
        const remaining = threads.filter((t) => t.id !== threadId);
        if (remaining.length > 0) {
          onSelectThread(remaining[0].id);
        } else {
          onNewThread();
        }
      }
    } catch {
      toast.error("Failed to delete thread");
    }
  };

  // Filter threads by channel
  const filteredThreads = channelFilter === "all"
    ? threads
    : threads.filter((t) => t.type === channelFilter);

  // Count threads by channel for the filter badges
  const channelCounts = threads.reduce<Record<string, number>>((acc, t) => {
    acc[t.type] = (acc[t.type] || 0) + 1;
    return acc;
  }, {});

  // Available channels (only show filters for channels that have threads)
  const availableChannels = Object.keys(channelCounts).sort();

  if (collapsed) {
    return (
      <div className="flex flex-col items-center py-2 px-1 border-r gap-1 bg-sidebar">
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={() => setCollapsed(false)}
          title="Expand threads"
        >
          <PanelLeft className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onNewThread}
          title="New thread"
        >
          <Plus className="size-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col w-72 h-full border-r shrink-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Threads
        </span>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={onNewThread}
            title="New thread"
          >
            <Plus className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => setCollapsed(true)}
            title="Collapse"
          >
            <PanelLeftClose className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* Channel Filter Tabs */}
      {availableChannels.length > 1 && (
        <div className="flex items-center gap-0.5 px-2 py-1.5 border-b overflow-x-auto">
          <Button
            variant={channelFilter === "all" ? "secondary" : "ghost"}
            size="sm"
            className="h-6 px-2 text-[10px] font-medium shrink-0"
            onClick={() => setChannelFilter("all")}
          >
            All
            <span className="ml-1 text-muted-foreground">{threads.length}</span>
          </Button>
          {availableChannels.map((ch) => {
            const config = CHANNEL_CONFIG[ch];
            if (!config) return null;
            const Icon = config.icon;
            return (
              <Button
                key={ch}
                variant={channelFilter === ch ? "secondary" : "ghost"}
                size="sm"
                className="h-6 px-2 text-[10px] font-medium shrink-0"
                onClick={() => setChannelFilter(ch as ChannelFilter)}
                title={config.label}
              >
                <Icon className={cn("size-3 mr-0.5", config.color)} />
                <span className="hidden sm:inline">{config.label}</span>
                <span className="ml-1 text-muted-foreground">{channelCounts[ch]}</span>
              </Button>
            );
          })}
        </div>
      )}

      {/* Thread list */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="py-1">
          {filteredThreads.map((thread) => {
            const channelConf = CHANNEL_CONFIG[thread.type];
            const ChannelIcon = channelConf?.icon || MessageSquare;
            const channelColor = channelConf?.color || "text-muted-foreground";

            const threadTime = new Date(thread.updatedAt).getTime();
            const lastRead = readTimestamps[thread.id] || 0;
            const isUnread = thread.id !== activeThreadId && threadTime > lastRead;

            return (
              <div
                key={thread.id}
                className={cn(
                  "group flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors",
                  thread.id === activeThreadId && "bg-accent"
                )}
                onClick={() => {
                  if (renamingId !== thread.id) onSelectThread(thread.id);
                }}
              >
                <ChannelIcon className={cn("size-3.5 shrink-0", channelColor)} />

                <div className="flex-1 min-w-0">
                  {renamingId === thread.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleRename(thread.id);
                      }}
                      className="flex items-center gap-1"
                    >
                      <Input
                        ref={renameInputRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        className="h-5 text-xs px-1"
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        onBlur={() => handleRename(thread.id)}
                      />
                    </form>
                  ) : (
                    <>
                      <p className={cn("text-xs truncate flex items-center gap-1.5", isUnread ? "font-semibold text-foreground" : "font-medium")}>
                        {isUnread && <span className="size-1.5 rounded-full bg-blue-500 shrink-0" />}
                        {thread.name}
                        {processingIds.includes(thread.id) && (
                          <span className="relative flex size-2 shrink-0">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            <span className="relative inline-flex rounded-full size-2 bg-emerald-500" />
                          </span>
                        )}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {processingIds.includes(thread.id)
                          ? "Thinking..."
                          : `${thread.messageCount} msgs · ${timeAgo(thread.updatedAt)}`
                        }
                      </p>
                    </>
                  )}
                </div>

                {renamingId !== thread.id && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="size-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-32">
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(thread.id);
                          setRenameValue(thread.name);
                        }}
                      >
                        <Pencil className="size-3 mr-2" />
                        Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(thread.id);
                        }}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="size-3 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}

          {filteredThreads.length === 0 && (
            <div className="px-3 py-6 text-center">
              <p className="text-xs text-muted-foreground">
                {channelFilter === "all"
                  ? "No threads yet"
                  : `No ${CHANNEL_CONFIG[channelFilter]?.label || channelFilter} threads`}
              </p>
              {channelFilter === "all" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-2 text-xs"
                  onClick={onNewThread}
                >
                  <Plus className="size-3 mr-1" />
                  Start a thread
                </Button>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
