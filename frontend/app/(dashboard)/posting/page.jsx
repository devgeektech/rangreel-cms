"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bell,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  LayoutDashboard,
  Send,
} from "lucide-react";
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
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/posting", label: "Dashboard", icon: LayoutDashboard },
  { href: "/posting/notifications", label: "Notifications", icon: Bell },
];

const accent = "#EF4444";

function stageStatusBadge(status) {
  const s = String(status || "").toLowerCase();
  if (s === "completed") return <Badge className="bg-green-600 text-white">Completed</Badge>;
  if (s === "approved") return <Badge variant="outline">Approved</Badge>;
  if (s === "in_progress") return <Badge variant="outline">In Progress</Badge>;
  if (s === "assigned" || s === "planned") return <Badge variant="outline">Assigned</Badge>;
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
  const [postingTab, setPostingTab] = useState("pending");
  const [openReelDetail, setOpenReelDetail] = useState(false);
  const [selectedContentId, setSelectedContentId] = useState(null);

  const reloadTasks = useCallback(async () => {
    const res = await api.getMyTasks(month);
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

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key !== "rr:tasksUpdated") return;
      reloadTasks().catch(() => {});
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [reloadTasks]);

  const postStages = useMemo(() => {
    const entries = [];
    (tasks || []).forEach((t) => {
      (t.stages || []).forEach((stage) => {
        if (String(stage.stageName).toLowerCase() === "post") {
          entries.push({
            itemId: t.contentItemId,
            title: t.title,
            contentType: t.contentType,
            clientBrand: t.clientBrandName,
            stage,
          });
        }
      });
    });
    return entries.sort((a, b) => new Date(a.stage.dueDate) - new Date(b.stage.dueDate));
  }, [tasks]);

  const todayStartMs = useMemo(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).getTime();
  }, []);

  const stats = useMemo(() => {
    let overdue = 0;
    let completed = 0;
    let pending = 0;
    for (const entry of postStages) {
      if (isWorkflowStageCompleted(entry.stage, "posting")) {
        completed += 1;
      } else {
        pending += 1;
        if (isWorkflowStageOverdue(entry.stage, todayStartMs)) overdue += 1;
      }
    }
    return {
      total: postStages.length,
      pending,
      completed,
      overdue,
    };
  }, [postStages, todayStartMs]);

  const postStagesPending = useMemo(
    () =>
      postStages.filter(
        ({ stage }) => !isWorkflowStageCompleted(stage, "posting")
      ),
    [postStages]
  );

  const postStagesCompleted = useMemo(
    () =>
      postStages.filter(({ stage }) =>
        isWorkflowStageCompleted(stage, "posting")
      ),
    [postStages]
  );

  const visiblePostStages =
    postingTab === "pending" ? postStagesPending : postStagesCompleted;

  return (
    <DashboardShell navItems={navItems}>
      <section className="space-y-6">
        <Card className="border-[#EF4444]/30 bg-gradient-to-r from-[#EF4444]/15 to-transparent">
          <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold">Posting Dashboard</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Manage post-ready tasks and mark items as posted.
              </p>
            </div>
            <Send className="h-10 w-10 shrink-0 text-[#EF4444]" />
          </CardContent>
        </Card>

        {!loading && postStages.length > 0 ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="border-border/80 shadow-sm">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-rose-500/15 text-rose-600 dark:text-rose-400">
                  <ClipboardList className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{stats.total}</p>
                  <p className="text-xs text-muted-foreground">All posting tasks</p>
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/80 shadow-sm">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  <Send className="h-5 w-5" />
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

        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">My posting tasks</CardTitle>
                {!loading && postStages.length > 0 ? (
                  <div className="mt-3 inline-flex flex-wrap gap-2 rounded-lg border border-border bg-muted/30 p-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={postingTab === "pending" ? "default" : "ghost"}
                      className="h-8"
                      onClick={() => setPostingTab("pending")}
                    >
                      Pending ({postStagesPending.length})
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={postingTab === "completed" ? "default" : "ghost"}
                      className="h-8"
                      onClick={() => setPostingTab("completed")}
                    >
                      Completed ({postStagesCompleted.length})
                    </Button>
                  </div>
                ) : null}
              </div>
              <TaskMonthControls month={month} onMonthChange={setMonth} accent={accent} />
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
            ) : postStages.length === 0 ? (
              <EmptyState
                title="No posting tasks this month"
                description="You’ll see your posting tasks once they’re assigned."
              />
            ) : visiblePostStages.length === 0 ? (
              <EmptyState
                title={postingTab === "pending" ? "No pending posting tasks" : "No completed posting tasks yet"}
                description={
                  postingTab === "pending"
                    ? "Completed items move to the Completed tab."
                    : "Mark tasks as posted from Pending to see them here."
                }
              />
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {visiblePostStages.map(({ itemId, title, clientBrand, contentType, stage }) => {
                  const stageId = stage._id;
                  const posted = isWorkflowStageCompleted(stage, "posting");
                  const status = String(stage.status || "").toLowerCase();
                  const overdue = isWorkflowStageOverdue(stage, todayStartMs);
                  const dueText = stage?.dueDate
                    ? new Date(stage.dueDate).toLocaleDateString(undefined, {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })
                    : "—";
                  return (
                    <div
                      key={stageId}
                      className={cn(
                        "flex h-full min-h-[220px] flex-col rounded-xl border border-border bg-card/50 p-3 shadow-sm transition-colors hover:bg-card/80 sm:p-4",
                        overdue && !posted && "border-destructive/35"
                      )}
                    >
                      <div className="min-w-0 flex-1 space-y-2">
                        <h3
                          className={cn(
                            "line-clamp-2 text-sm font-semibold leading-snug sm:text-base",
                            posted && "line-through text-muted-foreground"
                          )}
                        >
                          {title}
                        </h3>
                        <p className="line-clamp-1 text-xs text-muted-foreground sm:text-sm">
                          {clientBrand || "—"}
                        </p>
                        <div className="space-y-1 text-[11px] leading-snug text-muted-foreground sm:text-xs">
                          <p>
                            <span className="font-medium text-foreground">Post due</span> {dueText}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="secondary" className="text-[10px] font-normal sm:text-xs">
                            {contentTypeLabel(contentType)}
                          </Badge>
                          {overdue ? <Badge variant="destructive">Overdue</Badge> : null}
                          {posted ? (
                            <Badge className="bg-green-600 text-[10px] text-white sm:text-xs">Completed</Badge>
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
                          View details
                        </button>
                      </div>

                      <div className="mt-3 flex flex-col gap-2 border-t border-border/60 pt-3">
                        {!posted && (status === "assigned" || status === "planned") ? (
                          <Button
                            size="sm"
                            className="w-full"
                            onClick={async () => {
                              try {
                                if (status !== "in_progress") {
                                  await api.updateMyTaskStatus(itemId, stageId, { status: "in_progress" });
                                }
                                await api.updateMyTaskStatus(itemId, stageId, { status: "completed" });
                                toast.success("Marked as posted");
                                await reloadTasks();
                              } catch (error) {
                                toast.error(error.message || "Failed to mark as posted");
                              }
                            }}
                          >
                            Mark as Posted
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
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
        viewerRole="postingExecutive"
        onDidMutate={reloadTasks}
      />
    </DashboardShell>
  );
}
