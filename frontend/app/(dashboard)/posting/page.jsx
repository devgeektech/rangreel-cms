"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, LayoutDashboard, ListOrdered, Send } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { api } from "@/lib/api";
import EmptyState from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskMonthControls } from "@/components/role-dashboard/TaskMonthControls";
import { isWorkflowStageCompleted, isWorkflowStageOverdue } from "@/lib/roleDashboardTasks";
import { ReelDetailDialog } from "@/components/reel/ReelDetailDialog";

const navItems = [
  { href: "/posting", label: "Dashboard", icon: LayoutDashboard },
  { href: "/posting/calendar", label: "Calendar", icon: CalendarClock },
  { href: "/posting/queue", label: "Queue", icon: ListOrdered },
  { href: "/posting/published", label: "Published", icon: Send },
];

const accent = "#EF4444";

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toYMDUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function getTodayStartUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDaysUTC(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function getWeekStartMondayUTC(today) {
  const day = today.getUTCDay(); // 0=Sun
  const diffToMonday = (day + 6) % 7; // Mon -> 0, Sun -> 6
  return addDaysUTC(today, -diffToMonday);
}

function stageStatusBadge(status) {
  const s = String(status || "").toLowerCase();
  if (s === "completed") return <Badge className="bg-green-600 text-white">Completed</Badge>;
  if (s === "approved") return <Badge variant="outline">Approved</Badge>;
  if (s === "in_progress") return <Badge variant="outline">In Progress</Badge>;
  if (s === "assigned") return <Badge variant="outline">Assigned</Badge>;
  if (s === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function contentTypeLabel(ct) {
  const t = String(ct || "").toLowerCase();
  if (t === "reel") return "Reel";
  if (t === "static_post") return "Static";
  if (t === "carousel") return "Carousel";
  if (t === "gmb_post") return "GMB";
  if (t === "campaign") return "Campaign";
  return ct || "Content";
}

export default function PostingDashboardPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [openReelDetail, setOpenReelDetail] = useState(false);
  const [selectedContentId, setSelectedContentId] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const res = await api.getMyTasks(month);
        setTasks(Array.isArray(res?.data) ? res.data : []);
      } catch (error) {
        toast.error(error.message || "Failed to load tasks");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [month]);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== "rr:tasksUpdated") return;
      api
        .getMyTasks(month)
        .then((res) => setTasks(Array.isArray(res?.data) ? res.data : []))
        .catch(() => {});
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [month]);

  const postStages = useMemo(() => {
    const entries = [];
    (tasks || []).forEach((t) => {
      (t.stages || []).forEach((stage) => {
        if (String(stage.stageName).toLowerCase() === "post") {
          entries.push({
            itemId: t.contentItemId,
            title: t.title,
            contentType: t.contentType,
            plan: t.plan,
            clientBrand: t.clientBrandName,
            stage,
          });
        }
      });
    });
    return entries.sort((a, b) => new Date(a.stage.dueDate) - new Date(b.stage.dueDate));
  }, [tasks]);

  const todayStart = useMemo(() => getTodayStartUTC(), []);
  const todayYMD = toYMDUTC(todayStart);

  const publishedTodayCount = useMemo(() => {
    return postStages.filter((x) => {
      const status = String(x.stage.status || "").toLowerCase();
      if (status !== "completed") return false;
      const completedAt = x.stage.completedAt ? new Date(x.stage.completedAt) : null;
      if (!completedAt || Number.isNaN(completedAt.getTime())) return false;
      return toYMDUTC(completedAt) === todayYMD;
    }).length;
  }, [postStages, todayYMD]);

  const weekDays = useMemo(() => {
    const start = getWeekStartMondayUTC(todayStart);
    return Array.from({ length: 7 }).map((_, idx) => addDaysUTC(start, idx));
  }, [todayStart]);

  const tasksByWeekDay = useMemo(() => {
    const map = new Map();
    for (const d of weekDays) map.set(toYMDUTC(d), []);
    for (const entry of postStages) {
      const dueYMD = entry.stage?.dueDate ? toYMDUTC(new Date(entry.stage.dueDate)) : null;
      if (dueYMD && map.has(dueYMD)) map.get(dueYMD).push(entry);
    }
    return map;
  }, [postStages, weekDays]);

  const todayStartMs = todayStart.getTime();

  return (
    <DashboardShell navItems={navItems}>
      <section className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Posting Dashboard</h2>
            <p className="text-sm text-muted-foreground">Mark posts as published and track the week.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <TaskMonthControls month={month} onMonthChange={setMonth} accent={accent} />
            <Badge className="bg-[#EF4444] text-white">Published today: {publishedTodayCount}</Badge>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Week view</CardTitle>
              <p className="text-xs text-muted-foreground">
                Post stages due this week (from tasks loaded for {month}). Today is highlighted.
              </p>
            </CardHeader>
            <CardContent className="grid grid-cols-7 gap-2">
              {weekDays.map((d) => {
                const key = toYMDUTC(d);
                const label = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
                const dayNum = d.getUTCDate();
                const isToday = key === todayYMD;
                const dayTasks = tasksByWeekDay.get(key) || [];
                return (
                  <div
                    key={key}
                    className={`rounded-lg border p-2 text-center ${
                      isToday ? "border-[#EF4444]/50 bg-[#EF4444]/5" : "border-border"
                    }`}
                  >
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className={`text-sm font-semibold ${isToday ? "text-[#EF4444]" : ""}`}>{dayNum}</p>
                    <div className="mt-2 space-y-1">
                      {dayTasks.slice(0, 2).map((t) => (
                        <div key={t.stage._id} className="truncate rounded-md bg-[#EF4444]/10 px-2 py-1 text-[11px] text-[#EF4444]">
                          {t.title}
                        </div>
                      ))}
                      {dayTasks.length > 2 ? <p className="text-[11px] text-muted-foreground">+{dayTasks.length - 2}</p> : null}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Post stages (selected month)</CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-6 w-20" />
                    </div>
                  ))}
                </div>
              ) : postStages.length === 0 ? (
                <EmptyState title="No reels assigned yet" description="Reels will appear here once the Post stage is assigned." />
              ) : (
                <div className="space-y-3">
                  {postStages.map(({ itemId, title, clientBrand, contentType, stage }) => {
                    const stageId = stage._id;
                    const posted = isWorkflowStageCompleted(stage, "posting");
                    const overdue = isWorkflowStageOverdue(stage, todayStartMs);
                    const dueText = stage?.dueDate ? new Date(stage.dueDate).toLocaleDateString() : "-";
                    return (
                      <div key={stageId} className="rounded-lg border border-border p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className={`text-sm font-semibold ${posted ? "line-through opacity-70" : ""}`}>{title}</p>
                            <button
                              type="button"
                              className="mt-1 text-xs text-primary underline underline-offset-2"
                              onClick={() => {
                                setSelectedContentId(itemId);
                                setOpenReelDetail(true);
                              }}
                            >
                              View reel details
                            </button>
                            <p className="text-xs text-muted-foreground">{clientBrand}</p>
                            <div className="mt-2 flex flex-wrap items-center gap-2">
                              <Badge variant="outline">{contentTypeLabel(contentType)}</Badge>
                              <Badge variant="outline">Post</Badge>
                              <span className={overdue ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>
                                Due: {dueText}
                              </span>
                              {overdue ? <Badge variant="destructive">Overdue</Badge> : null}
                              {posted ? <Badge className="bg-green-600 text-white">Completed</Badge> : stageStatusBadge(stage.status)}
                            </div>
                          </div>

                          <div className="w-full sm:w-[240px]" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </section>

      <ReelDetailDialog
        open={openReelDetail}
        onOpenChange={(v) => {
          setOpenReelDetail(v);
          if (!v) setSelectedContentId(null);
        }}
        contentId={selectedContentId}
        viewerRole="postingExecutive"
        onDidMutate={async () => {
          const res = await api.getMyTasks(month);
          setTasks(Array.isArray(res?.data) ? res.data : []);
        }}
      />
    </DashboardShell>
  );
}
