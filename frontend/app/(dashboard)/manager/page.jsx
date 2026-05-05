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

function shiftMonthYYYYMM(monthStr, delta) {
  const m = String(monthStr || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return monthStr;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const d = new Date(Date.UTC(year, monthIndex, 1));
  d.setUTCMonth(d.getUTCMonth() + delta);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

function buildMonthWindow(centerMonth, before = 1, after = 6) {
  const out = [];
  for (let i = -before; i <= after; i += 1) out.push(shiftMonthYYYYMM(centerMonth, i));
  return out;
}

function formatMonthLabel(monthKey) {
  const m = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return monthKey;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
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
  const [calendarTasks, setCalendarTasks] = useState([]); // current month
  const [calendarTasksWide, setCalendarTasksWide] = useState([]); // cross-month
  const [actionLoading, setActionLoading] = useState(false);
  const [selectedApprovalMonth, setSelectedApprovalMonth] = useState(currentMonth);

  const load = async () => {
    try {
      setLoading(true);
      const monthWindow = buildMonthWindow(currentMonth, 1, 6);
      const [clientsRes, calendarRes, wideCalendarRes] = await Promise.all([
        api.getMyClients(),
        api.getManagerGlobalCalendarFinal(currentMonth),
        Promise.all(monthWindow.map((m) => api.getManagerGlobalCalendarFinal(m))),
      ]);
      setClients(clientsRes?.data || []);
      setCalendarTasks(
        calendarRes?.data?.updatedTasks ||
          calendarRes?.updatedTasks ||
          calendarRes?.data?.tasks ||
          calendarRes?.tasks ||
          []
      );
      const mergedWide = [];
      for (const r of wideCalendarRes || []) {
        const rows = r?.data?.updatedTasks || r?.updatedTasks || r?.data?.tasks || r?.tasks || [];
        mergedWide.push(...rows);
      }
      setCalendarTasksWide(mergedWide);
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
    const pendingApprovals = (calendarTasksWide || []).filter((t) => {
      const name = String(t.stageName || "").toLowerCase();
      const status = String(t.status || "").toLowerCase();
      return name === "approval" && status !== "approved" && status !== "rejected";
    }).length;
    const totalItems = uniqueContent.size;
    const activeContent = Math.max(totalItems - postedCount, 0);
    const completionRate = totalItems ? Math.round((postedCount / totalItems) * 100) : 0;
    return { totalClients, activeContent, pendingApprovals, completionRate, postedCount, totalItems };
  }, [clients.length, tasks, calendarTasksWide]);

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

  const pendingApprovalStagesWide = useMemo(() => {
    const map = new Map();
    for (const task of calendarTasksWide || []) {
      const name = String(task.stageName || "").toLowerCase();
      const status = String(task.status || "").toLowerCase();
      if (!(name === "approval" && status !== "approved" && status !== "rejected")) continue;
      const dueDate = (task.dates || []).slice(-1)[0] || "";
      const key = `${String(task.contentItemId || "")}|${String(task.stageId || "")}|${dueDate}`;
      if (map.has(key)) continue;
      map.set(key, {
        itemId: task.contentItemId,
        stageId: task.stageId || null,
        title: task.title || "Untitled",
        clientBrand: task.clientName || "",
        dueDate,
        status: task.status,
      });
    }
    const list = [...map.values()];
    list.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    return list;
  }, [calendarTasksWide]);

  const approvalCalendarBuckets = useMemo(() => {
    const byMonth = {};
    for (const stage of pendingApprovalStagesWide) {
      const d = stage?.dueDate ? new Date(stage.dueDate) : null;
      if (!d || Number.isNaN(d.getTime())) continue;
      const monthKey = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
      const dayKey = toYMDUTC(d);
      if (!byMonth[monthKey]) byMonth[monthKey] = {};
      if (!byMonth[monthKey][dayKey]) byMonth[monthKey][dayKey] = [];
      byMonth[monthKey][dayKey].push(stage);
    }
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([monthKey, days]) => ({
        monthKey,
        days: Object.entries(days)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([dayKey, items]) => ({ dayKey, items })),
      }));
  }, [pendingApprovalStagesWide]);

  const availableApprovalMonths = useMemo(
    () => approvalCalendarBuckets.map((b) => b.monthKey),
    [approvalCalendarBuckets]
  );
  const selectedApprovalBucket = useMemo(
    () =>
      approvalCalendarBuckets.find((b) => b.monthKey === selectedApprovalMonth) ||
      approvalCalendarBuckets[0] ||
      null,
    [approvalCalendarBuckets, selectedApprovalMonth]
  );

  useEffect(() => {
    if (!availableApprovalMonths.length) return;
    if (!availableApprovalMonths.includes(selectedApprovalMonth)) {
      setSelectedApprovalMonth(availableApprovalMonths.includes(currentMonth) ? currentMonth : availableApprovalMonths[0]);
    }
  }, [availableApprovalMonths, selectedApprovalMonth, currentMonth]);

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
              <p className="text-sm text-muted-foreground">
                All pending approvals across calendars with month selection.
              </p>
            </div>
            <Badge variant="outline">{pendingApprovalStagesWide.length}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, idx) => (
                <div key={idx} className="rounded-lg border border-border p-3">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="mt-2 h-4 w-full" />
                </div>
              ))}
            </div>
          ) : approvalCalendarBuckets.length === 0 ? (
            <EmptyApprovalsState />
          ) : (
            <div className="space-y-3">
              <div className="overflow-x-auto pb-1">
                <div className="flex min-w-max gap-2">
                  {availableApprovalMonths.map((monthKey) => (
                    <Button
                      key={monthKey}
                      size="sm"
                      variant={selectedApprovalMonth === monthKey ? "default" : "outline"}
                      onClick={() => setSelectedApprovalMonth(monthKey)}
                    >
                      {formatMonthLabel(monthKey)}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="h-[420px] overflow-y-auto rounded-xl border border-border p-3 scroll-smooth">
                {!selectedApprovalBucket ? (
                  <EmptyApprovalsState />
                ) : (
                  <div className="space-y-2">
                    {selectedApprovalBucket.days.map((dayBucket) => (
                      <div
                        key={`${selectedApprovalBucket.monthKey}|${dayBucket.dayKey}`}
                        className="rounded-lg border border-border/60 p-2"
                      >
                        <p className="text-xs font-medium text-muted-foreground">{dayBucket.dayKey}</p>
                        <div className="mt-2 space-y-2">
                          {dayBucket.items.map((stage) => (
                            <div
                              key={`${stage.itemId}|${stage.stageId}|${stage.dueDate}`}
                              className="flex flex-wrap items-center justify-between gap-2 text-sm"
                            >
                              <div className="min-w-0">
                                <p className="truncate font-medium">{stage.title}</p>
                                <p className="truncate text-xs text-muted-foreground">{stage.clientBrand}</p>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                {stage.stageId ? (
                                  <>
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
                                  </>
                                ) : (
                                  <Badge variant="outline">View only</Badge>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
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
