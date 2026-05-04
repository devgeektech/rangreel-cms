"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Film,
  LayoutDashboard,
  Bell,
  Sparkles,
} from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getMyTasksIncludingCompleted } from "@/lib/userMyTasksApi";
import EmptyState from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskMonthControls } from "@/components/role-dashboard/TaskMonthControls";
import { ReelDetailDialog } from "@/components/reel/ReelDetailDialog";
import { StrategistPlanCalendar } from "./StrategistPlanCalendar";
import { SubmitPlanDialog } from "@/components/strategist/SubmitPlanDialog";
import {
  getTodayStartMs,
  getTodayYMDUTC,
  isStageInDateScope,
  isWorkflowStageCompleted,
  isWorkflowStageOverdue,
} from "@/lib/roleDashboardTasks";
import { cn } from "@/lib/utils";
import { contentTaskDisplayLabel } from "@/lib/contentDisplayLabel";

const navItems = [
  { href: "/strategist", label: "Dashboard", icon: LayoutDashboard },
  { href: "/strategist/global-calendar", label: "Calendar", icon: Calendar },
  { href: "/strategist/notifications", label: "Notifications", icon: Bell },
];

const accent = "#0EA5E9";

function stageStatusBadge(stageStatus) {
  const s = String(stageStatus || "").toLowerCase();
  if (s === "completed") return <Badge className="bg-green-600 text-white hover:bg-green-600/90">Completed</Badge>;
  if (s === "approved") return <Badge variant="outline" className="border-emerald-600/40 text-emerald-700">Approved</Badge>;
  if (s === "in_progress") return <Badge variant="outline">In Progress</Badge>;
  if (s === "planned") return <Badge variant="outline">Assigned</Badge>;
  if (s === "assigned") return <Badge variant="outline">Assigned</Badge>;
  if (s === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  return <Badge variant="outline">{stageStatus}</Badge>;
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

function taskLabel(task) {
  return contentTaskDisplayLabel({
    strategistAlias: task?.strategistAlias,
    displayId: task?.displayId,
    title: task?.title,
  });
}

function emptyDraft() {
  return { hook: "", concept: "", captionDirection: "", contentBrief: [""] };
}

function isPlanPendingStage(stage) {
  const s = String(stage?.status || "").toLowerCase();
  return s === "assigned" || s === "planned" || s === "in_progress";
}

function isPlanCompletedStage(stage) {
  return String(stage?.status || "").toLowerCase() === "completed";
}

function draftFromStage(stage, fallback) {
  const base = fallback || emptyDraft();
  const brief = Array.isArray(stage?.contentBrief) && stage.contentBrief.length
    ? [...stage.contentBrief]
    : base.contentBrief?.length
      ? base.contentBrief
      : [""];
  return {
    hook: stage?.hook != null ? String(stage.hook) : base.hook,
    concept: stage?.concept != null ? String(stage.concept) : base.concept,
    captionDirection:
      stage?.captionDirection != null ? String(stage.captionDirection) : base.captionDirection,
    contentBrief: brief,
  };
}

export default function StrategistDashboardPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [planDrafts, setPlanDrafts] = useState({});
  const [openReelDetail, setOpenReelDetail] = useState(false);
  const [selectedContentId, setSelectedContentId] = useState(null);
  const [planDialogEntry, setPlanDialogEntry] = useState(null);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [planSubmitting, setPlanSubmitting] = useState(false);
  const [planTab, setPlanTab] = useState("pending");
  const [dateScope, setDateScope] = useState("currentMonth");

  const reloadTasks = useCallback(async () => {
    const res = await getMyTasksIncludingCompleted(month);
    setTasks(Array.isArray(res?.data) ? res.data : []);
  }, [month]);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        await reloadTasks();
      } catch (error) {
        toast.error(error.message || "Failed to load tasks");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [reloadTasks]);

  const planStages = useMemo(() => {
    const entries = [];
    (tasks || []).forEach((t) => {
      (t.stages || []).forEach((stage) => {
        if (String(stage.stageName).toLowerCase() === "plan") {
          entries.push({
            itemId: t.contentItemId,
            title: t.title,
            strategistAlias: t.strategistAlias || "",
            displayId: t.displayId || "",
            contentType: t.contentType,
            plan: t.plan,
            clientBrand: t.clientBrandName,
            clientPostingDate: t.clientPostingDate,
            stage,
          });
        }
      });
    });
    return entries.sort((a, b) => new Date(a.stage.dueDate) - new Date(b.stage.dueDate));
  }, [tasks]);

  const todayYmd = useMemo(() => getTodayYMDUTC(), []);
  const scopeRefYmd = useMemo(
    () => (dateScope === "currentMonth" ? `${month}-01` : todayYmd),
    [dateScope, month, todayYmd]
  );

  const scopedPlanStages = useMemo(
    () =>
      planStages.filter((e) =>
        isStageInDateScope(e.stage, dateScope, scopeRefYmd)
      ),
    [planStages, dateScope, scopeRefYmd]
  );

  const planStagesPending = useMemo(
    () => scopedPlanStages.filter((e) => isPlanPendingStage(e.stage)),
    [scopedPlanStages]
  );
  const planStagesCompleted = useMemo(
    () => scopedPlanStages.filter((e) => isPlanCompletedStage(e.stage)),
    [scopedPlanStages]
  );

  const visiblePlanStages = planTab === "pending" ? planStagesPending : planStagesCompleted;

  const planCalendarEntries = useMemo(
    () =>
      scopedPlanStages.filter((e) => {
        const ct = String(e.contentType || "").toLowerCase();
        const onCalendar =
          ct === "reel" ||
          ct === "static_post" ||
          ct === "post" ||
          ct === "carousel";
        return onCalendar;
      }),
    [scopedPlanStages]
  );

  const stats = useMemo(() => {
    const todayStartMs = getTodayStartMs();
    let overdue = 0;
    for (const e of planStagesPending) {
      if (isWorkflowStageOverdue(e.stage, todayStartMs)) overdue += 1;
    }
    return {
      total: scopedPlanStages.length,
      pending: planStagesPending.length,
      completed: planStagesCompleted.length,
      overdue,
    };
  }, [scopedPlanStages, planStagesPending, planStagesCompleted]);

  const todayStartMs = useMemo(() => getTodayStartMs(), []);

  const openSubmitPlanDialog = (entry) => {
    const sid = entry.stage._id;
    setPlanDrafts((prev) => ({
      ...prev,
      [sid]: draftFromStage(entry.stage, prev[sid]),
    }));
    setPlanDialogEntry(entry);
    setPlanDialogOpen(true);
  };

  const handleCalendarEvent = (entry) => {
    const status = String(entry.stage?.status || "").toLowerCase();
    if (status === "in_progress") {
      openSubmitPlanDialog(entry);
      return;
    }
    toast.message("Start planning", {
      description: "Use Start Planning on this task in the list below.",
    });
  };

  const handleSubmitPlan = async () => {
    if (!planDialogEntry) return;
    const { itemId, stage } = planDialogEntry;
    const stageId = stage._id;
    const draft = planDrafts[stageId] || emptyDraft();
    setPlanSubmitting(true);
    try {
      const cleanedContentBrief = (draft.contentBrief || [])
        .map((x) => String(x || "").trim())
        .filter((x) => x.length > 0);
      await api.updateMyTaskStatus(itemId, stageId, {
        status: "completed",
        hook: draft.hook,
        concept: draft.concept,
        captionDirection: draft.captionDirection,
        contentBrief: cleanedContentBrief,
      });
      toast.success("Plan submitted");
      setPlanDialogOpen(false);
      setPlanDialogEntry(null);
      setPlanTab("completed");
    } catch (error) {
      toast.error(error.message || "Failed to submit plan");
    } finally {
      setPlanSubmitting(false);
      await reloadTasks();
    }
  };

  return (
    <DashboardShell navItems={navItems}>
      <section className="space-y-6">
        <Card className="border-[#0EA5E9]/30 bg-gradient-to-r from-[#0EA5E9]/15 to-transparent">
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Strategist Dashboard</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Plan, submit, and keep content aligned — calendar shows reels, posts, and carousels; full task list below.
              </p>
            </div>
            <Sparkles className="h-10 w-10 shrink-0 text-[#0EA5E9]" />
          </CardContent>
        </Card>

        {!loading && scopedPlanStages.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="border-border/80 shadow-sm">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400">
                  <ClipboardList className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">All plan tasks</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/80 shadow-sm">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400">
                  <Film className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{stats.pending}</p>
                  <p className="text-xs text-muted-foreground">Pending</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/80 shadow-sm">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{stats.completed}</p>
                  <p className="text-xs text-muted-foreground">Completed</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/80 shadow-sm">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400">
                  <CalendarDays className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{stats.overdue}</p>
                  <p className="text-xs text-muted-foreground">Overdue (pending)</p>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {loading ? null : planCalendarEntries.length > 0 ? (
          <StrategistPlanCalendar
            monthStr={month}
            planEntries={planCalendarEntries}
            onSelectEvent={handleCalendarEvent}
          />
        ) : null}

        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">All plan tasks</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Brand, format, plan due date, and post date at a glance.
                </p>
                {!loading && scopedPlanStages.length > 0 ? (
                  <div className="mt-3 inline-flex flex-wrap gap-2 rounded-lg border border-border bg-muted/30 p-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={planTab === "pending" ? "default" : "ghost"}
                      className="h-8"
                      onClick={() => setPlanTab("pending")}
                    >
                      Pending ({planStagesPending.length})
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={planTab === "completed" ? "default" : "ghost"}
                      className="h-8"
                      onClick={() => setPlanTab("completed")}
                    >
                      Completed ({planStagesCompleted.length})
                    </Button>
                  </div>
                ) : null}
              </div>
              <TaskMonthControls
                month={month}
                onMonthChange={setMonth}
                accent={accent}
                dateScope={dateScope}
                onDateScopeChange={setDateScope}
              />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {Array.from({ length: 6 }).map((_, idx) => (
                  <div
                    key={idx}
                    className="flex flex-col gap-3 rounded-xl border border-border p-4"
                  >
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="mt-auto h-9 w-full" />
                  </div>
                ))}
              </div>
            ) : scopedPlanStages.length === 0 ? (
              <EmptyState
                title="No Plan tasks this month"
                description="You’ll see your Strategist Plan stages here once they’re assigned."
              />
            ) : visiblePlanStages.length === 0 ? (
              <EmptyState
                title={planTab === "pending" ? "No pending plan tasks" : "No completed plans yet"}
                description={
                  planTab === "pending"
                    ? "Completed items move to the Completed tab."
                    : "Submit a plan from the Pending tab to see it here."
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {visiblePlanStages.map(
                  ({
                    itemId,
                    title,
                    strategistAlias,
                    displayId,
                    clientBrand,
                    contentType,
                    clientPostingDate,
                    plan,
                    stage,
                  }) => {
                    const overdue = isWorkflowStageOverdue(stage, todayStartMs);
                    const status = String(stage.status || "").toLowerCase();
                    const completed = isWorkflowStageCompleted(stage, "default");
                    const dueText = stage?.dueDate
                      ? new Date(stage.dueDate).toLocaleDateString(undefined, {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : "—";
                    const postText = clientPostingDate
                      ? new Date(clientPostingDate).toLocaleDateString(undefined, {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })
                      : null;
                    const stageId = stage._id;
                    const isReel = String(contentType || "").toLowerCase() === "reel";

                    return (
                      <div
                        key={stageId}
                        className={cn(
                          "flex h-full min-h-[220px] flex-col rounded-xl border border-border bg-card/50 p-3 shadow-sm transition-colors hover:bg-card/80 sm:p-4",
                          overdue && !completed && "border-destructive/35"
                        )}
                      >
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-start gap-1.5">
                            <h3
                              className={cn(
                                "line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-snug sm:text-base",
                                completed && "text-muted-foreground line-through"
                              )}
                              title={taskLabel({
                                strategistAlias,
                                displayId: displayId || "",
                                title,
                              })}
                            >
                              {taskLabel({
                                strategistAlias,
                                displayId: displayId || "",
                                title,
                              })}
                            </h3>
                            <Badge variant="secondary" className="shrink-0 text-[10px] font-normal sm:text-xs">
                              {contentTypeLabel(contentType)}
                            </Badge>
                            {isReel ? (
                              <Film className="h-3.5 w-3.5 shrink-0 text-sky-500" aria-hidden />
                            ) : null}
                          </div>
                          <p className="line-clamp-1 text-xs text-muted-foreground sm:text-sm">
                            {clientBrand || "—"}
                          </p>
                          <div className="space-y-1 text-[11px] leading-snug text-muted-foreground sm:text-xs">
                            <p>
                              <span className="font-medium text-foreground">Plan due</span> {dueText}
                            </p>
                            {postText ? (
                              <p>
                                <span className="font-medium text-foreground">Post</span> {postText}
                              </p>
                            ) : null}
                            {String(plan || "").toLowerCase() === "urgent" ? (
                              <Badge variant="destructive" className="text-[10px]">
                                Urgent
                              </Badge>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {overdue ? <Badge variant="destructive">Overdue</Badge> : null}
                            {completed ? (
                              <Badge className="bg-green-600 text-[10px] text-white sm:text-xs">
                                Completed
                              </Badge>
                            ) : (
                              <span className="[&_span]:text-[10px] sm:[&_span]:text-xs">
                                {stageStatusBadge(stage.status)}
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            className="text-left text-[11px] font-medium text-primary underline-offset-4 hover:underline sm:text-xs"
                            onClick={() => {
                              setSelectedContentId(itemId);
                              setOpenReelDetail(true);
                            }}
                          >
                            {isReel ? "View reel details" : "View details"}
                          </button>
                        </div>

                        <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3">
                          {status === "assigned" || status === "planned" ? (
                            <Button
                              size="sm"
                              className="w-full"
                              onClick={async () => {
                                try {
                                  await api.updateMyTaskStatus(itemId, stageId, {
                                    status: "in_progress",
                                  });
                                  toast.success("Planning started");
                                  await reloadTasks();
                                } catch (error) {
                                  toast.error(error.message || "Failed to start planning");
                                }
                              }}
                            >
                              Start Planning
                            </Button>
                          ) : null}

                          {status === "in_progress" ? (
                            <Button
                              size="sm"
                              className="w-full"
                              style={{ backgroundColor: accent, color: "#fff" }}
                              onClick={() =>
                                openSubmitPlanDialog({
                                  itemId,
                                  title,
                                  contentType,
                                  clientBrand,
                                  clientPostingDate,
                                  stage,
                                })
                              }
                            >
                              Submit Plan
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  }
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <SubmitPlanDialog
        open={planDialogOpen}
        onOpenChange={(v) => {
          setPlanDialogOpen(v);
          if (!v) setPlanDialogEntry(null);
        }}
        title={planDialogEntry?.title || ""}
        clientBrand={planDialogEntry?.clientBrand || ""}
        dueText={
          planDialogEntry?.stage?.dueDate
            ? new Date(planDialogEntry.stage.dueDate).toLocaleDateString(undefined, {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })
            : ""
        }
        contentTypeLabel={
          planDialogEntry ? contentTypeLabel(planDialogEntry.contentType) : ""
        }
        draft={
          planDialogEntry
            ? planDrafts[planDialogEntry.stage._id] || draftFromStage(planDialogEntry.stage)
            : emptyDraft()
        }
        onDraftChange={(next) => {
          if (!planDialogEntry) return;
          const sid = planDialogEntry.stage._id;
          setPlanDrafts((prev) => ({ ...prev, [sid]: next }));
        }}
        onSubmit={handleSubmitPlan}
        submitting={planSubmitting}
        accent={accent}
      />

      <ReelDetailDialog
        open={openReelDetail}
        onOpenChange={(v) => {
          setOpenReelDetail(v);
          if (!v) setSelectedContentId(null);
        }}
        contentId={selectedContentId}
        viewerRole="strategist"
        onDidMutate={() => {
          void reloadTasks();
        }}
      />
    </DashboardShell>
  );
}
