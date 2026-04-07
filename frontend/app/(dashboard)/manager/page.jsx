"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, ClipboardCheck, PieChart, Users2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

const pad2 = (n) => String(n).padStart(2, "0");

function toYMDUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function getTodayStartUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isApprovalStagePending(stage) {
  const stageName = String(stage.stageName || "").toLowerCase();
  const role = String(stage.role || "").toLowerCase();
  const status = String(stage.status || "").toLowerCase();
  const isApproval = stageName === "approval" || stageName === "approve";
  const isManagerRole = role === "manager";
  const notResolved = status !== "approved" && status !== "rejected";
  return isApproval && isManagerRole && notResolved;
}

function StatCard({ title, value, loading, accent }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <p className="text-3xl font-semibold" style={accent ? { color: accent } : undefined}>
            {value}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function ManagerDashboardPage() {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState([]);
  const [calendarTasks, setCalendarTasks] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const [clientsRes, calendarRes] = await Promise.all([
        api.getMyClients(),
        api.getManagerGlobalCalendarFinal(currentMonth),
      ]);
      setClients(clientsRes?.data || []);
      setCalendarTasks(
        calendarRes?.data?.updatedTasks ||
          calendarRes?.updatedTasks ||
          calendarRes?.data?.tasks ||
          calendarRes?.tasks ||
          []
      );
    } catch (error) {
      toast.error(error.message || "Failed to load manager dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMonth]);

  const tasks = useMemo(() => calendarTasks || [], [calendarTasks]);

  const stats = useMemo(() => {
    const totalClients = clients.length;
    const uniqueContent = new Set(tasks.map((t) => String(t.contentItemId || "")).filter(Boolean));
    const postedCount = tasks.filter((t) => String(t.stageName || "").toLowerCase() === "post").length;
    const pendingApprovals = tasks.filter((t) => {
      const name = String(t.stageName || "").toLowerCase();
      const status = String(t.status || "").toLowerCase();
      return name === "approval" && status !== "approved" && status !== "rejected";
    }).length;
    const totalItems = uniqueContent.size;
    const activeContent = Math.max(totalItems - postedCount, 0);
    const completionRate = totalItems ? Math.round((postedCount / totalItems) * 100) : 0;
    return { totalClients, activeContent, pendingApprovals, completionRate, postedCount, totalItems };
  }, [clients.length, tasks]);

  const pendingApprovalStages = useMemo(() => {
    const list = [];
    (tasks || []).forEach((task) => {
      const name = String(task.stageName || "").toLowerCase();
      const status = String(task.status || "").toLowerCase();
      if (name === "approval" && status !== "approved" && status !== "rejected") {
        list.push({
          itemId: task.contentItemId,
          stageId: task.stageId || null,
          title: task.title || "Untitled",
          clientBrand: task.clientName || "",
          dueDate: (task.dates || []).slice(-1)[0],
          status: task.status,
        });
      }
    });
    list.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    return list;
  }, [tasks]);

  const todayStart = useMemo(() => getTodayStartUTC().getTime(), []);
  const isStageOverdue = (dueDate, status) => {
    const d = dueDate ? new Date(dueDate).getTime() : null;
    if (!d) return false;
    const s = String(status || "").toLowerCase();
    if (s === "submitted" || s === "posted" || s === "approved") return false;
    return d < todayStart;
  };

  const refresh = async () => load();

  const onStageAction = async (stage, nextStatus) => {
    if (!stage?.itemId || !stage?.stageId) {
      toast.error("Cannot update this stage from calendar data");
      return;
    }
    try {
      setActionLoading(true);
      await api.updateStageStatus(stage.itemId, stage.stageId, {
        status: nextStatus,
        rejectionNote: "",
      });
      toast.success(nextStatus === "approved" ? "Approved" : "Rejected");
      await refresh();
    } catch (error) {
      toast.error(error.message || "Action failed");
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Manager Dashboard</h2>
          <p className="text-sm text-muted-foreground">Review, approve and keep delivery on track.</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Total Clients" value={stats.totalClients} loading={loading} accent="#6C3EBF" />
        <StatCard title="Active Content This Month" value={stats.activeContent} loading={loading} accent="#E84393" />
        <StatCard title="Pending Approvals" value={stats.pendingApprovals} loading={loading} accent="#10B981" />
        <StatCard title="Monthly Completion Rate" value={`${stats.completionRate}%`} loading={loading} accent="#0EA5E9" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Pending Approvals</CardTitle>
              <p className="text-sm text-muted-foreground">Approve or reject approval stages awaiting your action.</p>
            </div>
            <Badge variant="outline">{pendingApprovalStages.length}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, idx) => (
                <div key={idx} className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                  <Skeleton className="h-4 w-64" />
                  <Skeleton className="h-6 w-28" />
                </div>
              ))}
            </div>
          ) : pendingApprovalStages.length === 0 ? (
            <EmptyApprovalsState />
          ) : (
            <div className="space-y-3">
              {pendingApprovalStages.map((stage) => {
                const overdue = isStageOverdue(stage.dueDate, stage.status);
                const dueText = stage.dueDate ? new Date(stage.dueDate).toLocaleDateString() : "-";
                return (
                  <div key={`${stage.itemId}|${stage.stageId}`} className="flex flex-col gap-3 rounded-xl border border-border p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{stage.title}</p>
                      <p className="text-xs text-muted-foreground">{stage.clientBrand}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge variant="outline">Approval</Badge>
                        <span className={overdue ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>Due: {dueText}</span>
                        {overdue ? <Badge variant="destructive">Overdue</Badge> : null}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={() => onStageAction(stage, "approved")}
                        disabled={actionLoading}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onStageAction(stage, "rejected")}
                        disabled={actionLoading}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

function EmptyApprovalsState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 p-6 text-center">
      <p className="text-sm font-medium">No pending approvals.</p>
      <p className="mt-1 text-xs text-muted-foreground">You’re all caught up for this month.</p>
    </div>
  );
}
