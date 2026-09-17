"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Clock, RefreshCw, Play, Pause } from "lucide-react";
import { StandardPage } from "@/components/workspace-frame";
import { ListToolbar } from "@/components/list-toolbar";
import { api } from "@/lib/api";

interface TaskSchedule {
  recurrence: string;
  cronExpression?: string;
  intervalMs?: number;
  startDate?: string;
  endDate?: string;
}

interface ScheduledTask {
  id: string;
  name: string;
  description?: string;
  schedule: TaskSchedule;
  status: string;
  enabled: boolean;
  tags: string[];
  metadata: Record<string, unknown>;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  failureCount: number;
}

function formatSchedule(schedule: TaskSchedule): string {
  if (schedule.recurrence === 'cron' && schedule.cronExpression) {
    return schedule.cronExpression;
  }
  if (schedule.recurrence === 'once' && schedule.startDate) {
    return `Once at ${new Date(schedule.startDate).toLocaleString()}`;
  }
  if (schedule.recurrence === 'interval' && schedule.intervalMs) {
    const secs = schedule.intervalMs / 1000;
    if (secs < 60) return `Every ${secs}s`;
    if (secs < 3600) return `Every ${Math.round(secs / 60)}m`;
    return `Every ${Math.round(secs / 3600)}h`;
  }
  return schedule.recurrence;
}

export default function SchedulerPage() {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("next");

  const loadTasks = async () => {
    setLoading(true);
    try {
      const data = await api<{ tasks: ScheduledTask[] }>("/api/scheduler/tasks");
      setTasks(data.tasks || []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTasks();
  }, []);

  const visibleTasks = tasks
    .filter((task) => {
      const matchesSearch = `${task.name} ${task.description || ""} ${task.tags.join(" ")}`.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || (statusFilter === "active" ? task.enabled && !["completed", "failed"].includes(task.status) : statusFilter === "disabled" ? !task.enabled : task.status === statusFilter);
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : (new Date(a.nextRunAt || 8640000000000000).getTime() - new Date(b.nextRunAt || 8640000000000000).getTime()));

  return (
    <StandardPage title="Automations" description="Manage scheduled tasks, recurring actions and execution status." actions={<Button variant="outline" onClick={loadTasks}><RefreshCw className="size-4"/>Refresh</Button>}>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tasks.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Active</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600 dark:text-green-500">
              {tasks.filter((t) => t.enabled && t.status !== 'completed' && t.status !== 'failed').length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-muted-foreground">
              {tasks.filter((t) => t.status === 'completed').length}
            </div>
          </CardContent>
        </Card>
      </div>

      <ListToolbar className="rounded-xl border bg-card" searchLabel="Search automations" searchPlaceholder="Search automations" searchValue={search} onSearchChange={setSearch} filters={[{label:"Automation status",value:statusFilter,onValueChange:setStatusFilter,options:[{value:"all",label:"All automations"},{value:"active",label:"Active"},{value:"disabled",label:"Disabled"},{value:"completed",label:"Completed"},{value:"failed",label:"Failed"}]}]} sort={{label:"Sort automations",value:sort,onValueChange:setSort,options:[{value:"next",label:"Next run"},{value:"name",label:"Name A–Z"}]}} resultLabel={`${visibleTasks.length} of ${tasks.length} automations`} active={!!search||statusFilter!=="all"||sort!=="next"} onReset={()=>{setSearch("");setStatusFilter("all");setSort("next");}} />

      {visibleTasks.length === 0 && !loading ? (
        <EmptyState
          icon={<Clock className="size-8" />}
          title={tasks.length ? "No matching automations" : "No scheduled tasks"}
          description={tasks.length ? "Try a different search or filter." : "You do not have any tasks or cron jobs configured yet."}
        />
      ) : (
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task</TableHead>
                <TableHead className="hidden sm:table-cell">Schedule</TableHead>
                <TableHead className="hidden lg:table-cell">Tags</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Next Run</TableHead>
                <TableHead className="hidden lg:table-cell">Last Run</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleTasks.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell className="hidden sm:table-cell">
                      <div className="font-medium">{task.name}</div>
                      {task.description && (
                        <div className="text-xs text-muted-foreground mt-0.5 max-w-xs truncate">{task.description}</div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-xs">
                        {formatSchedule(task.schedule)}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden text-sm lg:table-cell">
                      {task.tags?.length ? task.tags.join(', ') : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          task.status === 'completed' ? 'default' :
                          task.status === 'failed' ? 'destructive' :
                          task.status === 'running' ? 'default' :
                          task.enabled ? 'default' : 'secondary'
                        }
                        className={task.status === 'completed' ? 'bg-green-600' : undefined}
                      >
                        {task.status === 'completed' ? '✓ Completed' :
                         task.status === 'failed' ? '✗ Failed' :
                         task.status === 'running' ? (
                          <><Play className="size-3 mr-1" /> Running</>
                         ) :
                         task.enabled ? (
                          <><Clock className="size-3 mr-1" /> {task.status || 'Pending'}</>
                         ) : (
                          <><Pause className="size-3 mr-1" /> Paused</>
                         )}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground md:table-cell">
                      {task.nextRunAt
                        ? new Date(task.nextRunAt).toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {task.lastRunAt
                        ? new Date(task.lastRunAt).toLocaleString()
                        : "Never"}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      )}
    </StandardPage>
  );
}
