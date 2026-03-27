"use client";

import { useEffect, useMemo, useState } from "react";
import { BarChart3, ClipboardCheck, PieChart, TriangleAlert, Users2 } from "lucide-react";
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
  const [calendarGroups, setCalendarGroups] = useState([]);
  const [actionLoading, setActionLoading] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const [clientsRes, calendarRes] = await Promise.all([
        api.getMyClients(),
        api.getManagerGlobalCalendar(currentMonth),
      ]);
      setClients(clientsRes?.data || []);
      setCalendarGroups(calendarRes?.data?.groups || calendarRes?.groups || []);
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

  const items = useMemo(() => {
    const flat = [];
    (calendarGroups || []).forEach((g) => {
      (g.items || []).forEach((it) => flat.push(it));
    });
    return flat;
  }, [calendarGroups]);

  const stats = useMemo(() => {
    const totalClients = clients.length;
    const activeContent = items.filter((x) => String(x.overallStatus || "").toLowerCase() !== "posted").length;
    const postedCount = items.filter((x) => String(x.overallStatus || "").toLowerCase() === "posted").length;
    const pendingApprovals = items.flatMap((item) =>
      (item.workflowStages || []).filter((stage) => isApprovalStagePending(stage))
    ).length;
    const totalItems = items.length;
    const completionRate = totalItems ? Math.round((postedCount / totalItems) * 100) : 0;
    return { totalClients, activeContent, pendingApprovals, completionRate, postedCount, totalItems };
  }, [clients.length, items]);

  const pendingApprovalStages = useMemo(() => {
    const list = [];
    (items || []).forEach((item) => {
      const clientBrand = item.client?.brandName || item.client?.clientName || "";
      (item.workflowStages || []).forEach((stage) => {
        if (isApprovalStagePending(stage)) {
          list.push({
            itemId: item._id,
            stageId: stage._id,
            title: item.title,
            clientBrand,
            dueDate: stage.dueDate,
            status: stage.status,
          });
        }
      });
    });
    list.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    return list;
  }, [items]);

  const overbooking = useMemo(() => {
    const todayStart = getTodayStartUTC().getTime();
    const counts = new Map(); // dayKey|userId -> number

    for (const item of items || []) {
      for (const stage of item.workflowStages || []) {
        if (!stage?.assignedUser || !stage?.dueDate) continue;
        const status = String(stage.status || "").toLowerCase();
        if (status === "submitted" || status === "posted") continue;
        const dayKey = toYMDUTC(stage.dueDate);
        const userId = String(stage.assignedUser);
        const key = `${dayKey}|${userId}`;
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    }

    let biggest = null;
    for (const [key, count] of counts.entries()) {
      if (count < 3) continue;
      const [dayKey, userId] = key.split("|");
      const due = new Date(dayKey + "T00:00:00.000Z").getTime();
      const overdue = due < todayStart;
      biggest = biggest || { dayKey, userId, count, overdue };
      if (count > biggest.count) biggest = { dayKey, userId, count, overdue };
    }

    return biggest;
  }, [items]);

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

      {overbooking ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4">
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium text-destructive">
                Overbooking detected
              </p>
              <p className="text-sm text-muted-foreground">
                User <span className="font-medium text-foreground">{overbooking.userId.slice(-4)}</span> has{" "}
                <span className="font-medium text-foreground">{overbooking.count}</span> tasks on{" "}
                <span className="font-medium text-foreground">{overbooking.dayKey}</span>.
              </p>
            </div>
          </div>
        </div>
      ) : null}

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
