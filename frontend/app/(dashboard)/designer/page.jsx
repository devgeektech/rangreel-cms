"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  LayoutDashboard,
  Palette,
  Video,
} from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getMyTasksIncludingCompleted } from "@/lib/userMyTasksApi";
import EmptyState from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskMonthControls } from "@/components/role-dashboard/TaskMonthControls";
import { ReelDetailDialog } from "@/components/reel/ReelDetailDialog";
import { StrategistPlanCalendar } from "../strategist/StrategistPlanCalendar";
import {
  getTodayStartMs,
  getTodayYMDUTC,
  isStageInDateScope,
  isWorkflowStageCompleted,
  isWorkflowStageOverdue,
} from "@/lib/roleDashboardTasks";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/designer", label: "Dashboard", icon: LayoutDashboard },
  { href: "/designer/notifications", label: "Notifications", icon: Bell },
];

const accent = "#8B5CF6";

function stageStatusBadge(stageStatus) {
  const s = String(stageStatus || "").toLowerCase();
  if (s === "completed") return <Badge className="bg-green-600 text-white hover:bg-green-600/90">Completed</Badge>;
  if (s === "approved") return <Badge variant="outline" className="border-emerald-600/40 text-emerald-700">Approved</Badge>;
  if (s === "in_progress") return <Badge variant="outline">In Progress</Badge>;
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
  return String(task?.displayId || task?.title || "Task");
}

export default function DesignerDashboardPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [videoDrafts, setVideoDrafts] = useState({});
  const [videoUploading, setVideoUploading] = useState({});
  const [openReelDetail, setOpenReelDetail] = useState(false);
  const [selectedContentId, setSelectedContentId] = useState(null);
  const [designTab, setDesignTab] = useState("pending");
  const [dateScope, setDateScope] = useState("today");

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

  const designStages = useMemo(() => {
    const entries = [];
    (tasks || []).forEach((t) => {
      (t.stages || []).forEach((stage) => {
        const normalizedStageName = String(stage.stageName || "").toLowerCase();
        if (normalizedStageName === "design" || normalizedStageName === "work") {
          entries.push({
            itemId: t.contentItemId,
            title: t.title,
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
  const scopedDesignStages = useMemo(
    () =>
      designStages.filter((entry) =>
        isStageInDateScope(entry.stage, dateScope, scopeRefYmd)
      ),
    [designStages, dateScope, scopeRefYmd]
  );

  const designStagesPending = useMemo(
    () =>
      scopedDesignStages.filter((entry) => {
        const status = String(entry.stage?.status || "").toLowerCase();
        return status === "assigned" || status === "planned" || status === "in_progress";
      }),
    [scopedDesignStages]
  );

  const designStagesCompleted = useMemo(
    () =>
      scopedDesignStages.filter(
        (entry) => String(entry.stage?.status || "").toLowerCase() === "completed"
      ),
    [scopedDesignStages]
  );

  const visibleDesignStages =
    designTab === "pending" ? designStagesPending : designStagesCompleted;

  const designCalendarEntries = useMemo(
    () =>
      scopedDesignStages.filter((entry) => {
        const status = String(entry.stage?.status || "").toLowerCase();
        const ct = String(entry.contentType || "").toLowerCase();
        const onCalendar =
          ct === "reel" || ct === "static_post" || ct === "post" || ct === "carousel";
        return onCalendar && (status === "assigned" || status === "planned" || status === "in_progress");
      }),
    [scopedDesignStages]
  );

  const stats = useMemo(() => {
    const todayStartMs = getTodayStartMs();
    let overdue = 0;
    for (const entry of designStagesPending) {
      if (isWorkflowStageOverdue(entry.stage, todayStartMs)) overdue += 1;
    }
    return {
      total: scopedDesignStages.length,
      pending: designStagesPending.length,
      completed: designStagesCompleted.length,
      overdue,
    };
  }, [scopedDesignStages, designStagesPending, designStagesCompleted]);

  const todayStartMs = useMemo(() => getTodayStartMs(), []);

  const handleCalendarEvent = (entry) => {
    const status = String(entry.stage?.status || "").toLowerCase();
    if (status === "in_progress") {
      setSelectedContentId(entry.itemId);
      setOpenReelDetail(true);
      return;
    }
    toast.message("Start design task", {
      description: "Use Start Design on the task card below.",
    });
  };

  return (
    <DashboardShell navItems={navItems}>
      <section className="space-y-6">
        <Card className="border-[#8B5CF6]/30 bg-gradient-to-r from-[#8B5CF6]/15 to-transparent">
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Designer Dashboard</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Manage design tasks and submit final videos; due dates appear on calendar with full task cards below.
              </p>
            </div>
            <Palette className="h-10 w-10 shrink-0 text-[#8B5CF6]" />
          </CardContent>
        </Card>

        {!loading && scopedDesignStages.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="border-border/80 shadow-sm">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400">
                  <ClipboardList className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">All design tasks</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/80 shadow-sm">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400">
                  <Video className="h-5 w-5" />
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

        {loading ? null : designCalendarEntries.length > 0 ? (
          <StrategistPlanCalendar
            monthStr={month}
            planEntries={designCalendarEntries}
            onSelectEvent={handleCalendarEvent}
            headerTitle="Design schedule"
            iconClassName="text-violet-500"
          />
        ) : null}

        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">All design tasks</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Brand, format, due date, and post date at a glance.
                </p>
                {!loading && scopedDesignStages.length > 0 ? (
                  <div className="mt-3 inline-flex flex-wrap gap-2 rounded-lg border border-border bg-muted/30 p-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={designTab === "pending" ? "default" : "ghost"}
                      className="h-8"
                      onClick={() => setDesignTab("pending")}
                    >
                      Pending ({designStagesPending.length})
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={designTab === "completed" ? "default" : "ghost"}
                      className="h-8"
                      onClick={() => setDesignTab("completed")}
                    >
                      Completed ({designStagesCompleted.length})
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
                  <div key={idx} className="flex flex-col gap-3 rounded-xl border border-border p-4">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="mt-auto h-9 w-full" />
                  </div>
                ))}
              </div>
            ) : scopedDesignStages.length === 0 ? (
              <EmptyState
                title="No Design tasks this month"
                description="You’ll see your Designer tasks once they’re assigned."
              />
            ) : visibleDesignStages.length === 0 ? (
              <EmptyState
                title={designTab === "pending" ? "No pending design tasks" : "No completed design tasks yet"}
                description={
                  designTab === "pending"
                    ? "Completed items move to the Completed tab."
                    : "Submit a design task from Pending to see it here."
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {visibleDesignStages.map(
                  ({ itemId, title, displayId, clientBrand, contentType, clientPostingDate, plan, stage }) => {
                  const stageId = stage._id;
                  const status = String(stage.status || "").toLowerCase();
                  const overdue = isWorkflowStageOverdue(stage, todayStartMs);
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
                  const draft = videoDrafts[stageId] || { videoUrl: "", videoFile: null };
                  const uploading = Boolean(videoUploading[stageId]);
                  const isReel = String(contentType || "").toLowerCase() === "reel";

                  return (
                    <div
                      key={stageId}
                      className={cn(
                        "flex h-full min-h-[240px] flex-col rounded-xl border border-border bg-card/50 p-3 shadow-sm transition-colors hover:bg-card/80 sm:p-4",
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
                            title={taskLabel({ displayId, title })}
                          >
                            {taskLabel({ displayId, title })}
                          </h3>
                          <Badge variant="secondary" className="shrink-0 text-[10px] font-normal sm:text-xs">
                            {contentTypeLabel(contentType)}
                          </Badge>
                          {isReel ? (
                            <Video className="h-3.5 w-3.5 shrink-0 text-violet-500" aria-hidden />
                          ) : null}
                        </div>
                        <p className="line-clamp-1 text-xs text-muted-foreground sm:text-sm">
                          {clientBrand || "—"}
                        </p>
                        <div className="space-y-1 text-[11px] leading-snug text-muted-foreground sm:text-xs">
                          <p>
                            <span className="font-medium text-foreground">Design due</span> {dueText}
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
                        {(status === "assigned" || status === "planned") && !completed ? (
                          <Button
                            size="sm"
                            className="w-full"
                            onClick={async () => {
                              try {
                                await api.updateMyTaskStatus(itemId, stageId, {
                                  status: "in_progress",
                                });
                                toast.success("Design started");
                                await reloadTasks();
                              } catch (error) {
                                toast.error(error.message || "Failed to start design");
                              }
                            }}
                          >
                            Start Design
                          </Button>
                        ) : null}

                        {status === "in_progress" ? (
                          <>
                            <div className="space-y-1">
                              <p className="text-[10px] leading-tight text-muted-foreground">
                                Video URL (optional if you upload a file)
                              </p>
                              <Input
                                type="url"
                                className="h-8 text-xs"
                                placeholder="Paste video URL..."
                                value={draft.videoUrl}
                                onChange={(e) =>
                                  setVideoDrafts((prev) => ({
                                    ...prev,
                                    [stageId]: { ...draft, videoUrl: e.target.value },
                                  }))
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-[10px] leading-tight text-muted-foreground">Upload video file</p>
                              <Input
                                type="file"
                                className="h-8 cursor-pointer text-xs file:mr-2 file:text-xs"
                                accept="video/*"
                                disabled={uploading}
                                onChange={(e) =>
                                  setVideoDrafts((prev) => ({
                                    ...prev,
                                    [stageId]: {
                                      ...draft,
                                      videoFile: e.target.files?.[0] || null,
                                    },
                                  }))
                                }
                              />
                            </div>
                            <Button
                              size="sm"
                              className="w-full"
                              style={{ backgroundColor: accent, color: "#fff" }}
                              disabled={uploading}
                              onClick={async () => {
                                const trimmed = String(draft.videoUrl || "").trim();
                                const file = draft.videoFile;
                                if (!trimmed && !file) {
                                  toast.error("Add a video URL or upload a video file.");
                                  return;
                                }
                                try {
                                  setVideoUploading((prev) => ({ ...prev, [stageId]: true }));
                                  let resolvedVideoUrl = trimmed;
                                  if (file) {
                                    const resBody = await api.uploadVideo(file);
                                    const path = resBody?.data?.videoUrl ?? resBody?.videoUrl ?? "";
                                    if (!path) throw new Error("Upload did not return a file URL");
                                    resolvedVideoUrl = path;
                                  }
                                  await api.updateMyTaskStatus(itemId, stageId, {
                                    status: "completed",
                                    videoUrl: resolvedVideoUrl,
                                    designFileLink: resolvedVideoUrl,
                                  });
                                  toast.success("Video submitted");
                                  setVideoDrafts((prev) => ({
                                    ...prev,
                                    [stageId]: { videoUrl: "", videoFile: null },
                                  }));
                                  setDesignTab("completed");
                                } catch (error) {
                                  toast.error(error.message || "Failed to submit video");
                                } finally {
                                  setVideoUploading((prev) => ({ ...prev, [stageId]: false }));
                                  await reloadTasks();
                                }
                              }}
                            >
                              {uploading ? "Uploading..." : "Submit Video"}
                            </Button>
                          </>
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

      <ReelDetailDialog
        open={openReelDetail}
        onOpenChange={(v) => {
          setOpenReelDetail(v);
          if (!v) setSelectedContentId(null);
        }}
        contentId={selectedContentId}
        viewerRole="graphicdesigner"
        onDidMutate={reloadTasks}
      />
    </DashboardShell>
  );
}
