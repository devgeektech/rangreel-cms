"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bell, CheckCircle2, LayoutDashboard } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { StrategistPlanCalendar } from "../strategist/StrategistPlanCalendar";
import { api } from "@/lib/api";
import EmptyState from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskMonthControls } from "@/components/role-dashboard/TaskMonthControls";
import { ReelDetailDialog } from "@/components/reel/ReelDetailDialog";
import { getMyTasksIncludingCompleted } from "@/lib/userMyTasksApi";
import {
  getTodayStartMs,
  getTodayYMDUTC,
  isStageInDateScope,
  isWorkflowStageCompleted,
  isWorkflowStageOverdue,
} from "@/lib/roleDashboardTasks";

const navItems = [
  { href: "/editor", label: "Dashboard", icon: LayoutDashboard },
  { href: "/editor/notifications", label: "Notifications", icon: Bell },
];

const accent = "#10B981";

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

function isEditPendingStage(stage) {
  const s = String(stage?.status || "").toLowerCase();
  return s === "assigned" || s === "in_progress";
}

export default function EditorDashboardPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [editDrafts, setEditDrafts] = useState({});
  const [openReelDetail, setOpenReelDetail] = useState(false);
  const [selectedContentId, setSelectedContentId] = useState(null);
  const [dateScope, setDateScope] = useState("today");
  const [editTab, setEditTab] = useState("pending");

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

  const editStages = useMemo(() => {
    const entries = [];
    (tasks || []).forEach((t) => {
      (t.stages || []).forEach((stage) => {
        if (String(stage.stageName).toLowerCase() === "edit") {
          entries.push({
            itemId: t.contentItemId,
            title: t.title,
            displayId: t.displayId || "",
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

  const todayYmd = useMemo(() => getTodayYMDUTC(), []);
  const scopeRefYmd = useMemo(
    () => (dateScope === "currentMonth" ? `${month}-01` : todayYmd),
    [dateScope, month, todayYmd]
  );
  const scopedEditStages = useMemo(
    () =>
      editStages.filter((e) =>
        isStageInDateScope(e.stage, dateScope, scopeRefYmd)
      ),
    [editStages, dateScope, scopeRefYmd]
  );
  const editStagesPending = useMemo(
    () =>
      scopedEditStages.filter((e) => {
        const s = String(e.stage?.status || "").toLowerCase();
        return s === "assigned" || s === "in_progress";
      }),
    [scopedEditStages]
  );
  const editStagesCompleted = useMemo(
    () =>
      scopedEditStages.filter(
        (e) => String(e.stage?.status || "").toLowerCase() === "completed"
      ),
    [scopedEditStages]
  );
  const visibleEditStages = editTab === "pending" ? editStagesPending : editStagesCompleted;

  const editCalendarEntries = useMemo(
    () =>
      scopedEditStages.filter((e) => {
        const ct = String(e.contentType || "").toLowerCase();
        const onCalendar =
          ct === "reel" || ct === "static_post" || ct === "post" || ct === "carousel";
        return onCalendar && isEditPendingStage(e.stage);
      }),
    [scopedEditStages]
  );

  const todayStartMs = useMemo(() => getTodayStartMs(), []);

  const handleCalendarEvent = (entry) => {
    const status = String(entry.stage?.status || "").toLowerCase();
    if (status === "in_progress") {
      setSelectedContentId(entry.itemId);
      setOpenReelDetail(true);
      return;
    }
    toast.message("Start your edit", {
      description: "Use Start Edit on the task in the grid below.",
    });
  };

  return (
    <DashboardShell navItems={navItems}>
      <section className="space-y-6">
        <Card className="border-[#10B981]/30 bg-gradient-to-r from-[#10B981]/15 to-transparent">
          <CardContent className="flex items-center justify-between p-6">
            <div>
              <h2 className="text-2xl font-semibold">Editor Dashboard</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Start editing and submit your final edit — edit due dates on the calendar, full tasks below.
              </p>
            </div>
            <CheckCircle2 className="h-8 w-8 text-[#10B981]" />
          </CardContent>
        </Card>

        {loading ? null : editCalendarEntries.length > 0 ? (
          <StrategistPlanCalendar
            monthStr={month}
            planEntries={editCalendarEntries}
            onSelectEvent={handleCalendarEvent}
            headerTitle="Edit schedule"
            iconClassName="text-emerald-500"
          />
        ) : null}

        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">My tasks</CardTitle>
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
                  <div key={idx} className="flex flex-col gap-2 rounded-lg border border-border p-3">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                    <div className="flex gap-2">
                      <Skeleton className="h-5 w-12" />
                      <Skeleton className="h-5 w-14" />
                    </div>
                    <Skeleton className="mt-2 h-9 w-full" />
                  </div>
                ))}
              </div>
            ) : scopedEditStages.length === 0 ? (
              <EmptyState title="No Edit stages this month" description="You’ll see your Editor tasks once they’re assigned." />
            ) : visibleEditStages.length === 0 ? (
              <EmptyState
                title={editTab === "pending" ? "No pending edit tasks" : "No completed edit tasks yet"}
                description={
                  editTab === "pending"
                    ? "Completed items move to the Completed tab."
                    : "Submit edits from Pending to see them here."
                }
              />
            ) : (
              <div className="space-y-3">
                <div className="inline-flex flex-wrap gap-2 rounded-lg border border-border bg-muted/30 p-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={editTab === "pending" ? "default" : "ghost"}
                    className="h-8"
                    onClick={() => setEditTab("pending")}
                  >
                    Pending ({editStagesPending.length})
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={editTab === "completed" ? "default" : "ghost"}
                    className="h-8"
                    onClick={() => setEditTab("completed")}
                  >
                    Completed ({editStagesCompleted.length})
                  </Button>
                </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {visibleEditStages.map(({ itemId, title, displayId, clientBrand, contentType, stage }) => {
                  const stageId = stage._id;
                  const status = String(stage.status || "").toLowerCase();
                  const overdue = isWorkflowStageOverdue(stage, todayStartMs);
                  const completed = isWorkflowStageCompleted(stage, "default");
                  const dueText = stage?.dueDate ? new Date(stage.dueDate).toLocaleDateString() : "-";
                  const draft = editDrafts[stageId] || { editedFileLink: "" };

                  return (
                    <div
                      key={stageId}
                      className="flex min-h-0 flex-col rounded-lg border border-border bg-card p-3 shadow-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <p className={`line-clamp-2 text-sm font-semibold leading-snug ${completed ? "line-through opacity-70" : ""}`}>
                          {taskLabel({ displayId, title })}
                        </p>
                        <button
                          type="button"
                          className="mt-1 block truncate text-left text-xs text-primary underline underline-offset-2"
                          onClick={() => {
                            setSelectedContentId(itemId);
                            setOpenReelDetail(true);
                          }}
                        >
                          View reel details
                        </button>
                        <p className="truncate text-xs text-muted-foreground">{clientBrand}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className="text-[10px]">
                            {contentTypeLabel(contentType)}
                          </Badge>
                          <Badge variant="outline" className="text-[10px]">
                            Edit
                          </Badge>
                          <span
                            className={
                              overdue ? "text-[10px] font-medium text-destructive" : "text-[10px] text-muted-foreground"
                            }
                          >
                            Due: {dueText}
                          </span>
                          {overdue ? (
                            <Badge variant="destructive" className="text-[10px]">
                              Overdue
                            </Badge>
                          ) : null}
                          {completed ? (
                            <Badge className="bg-green-600 text-[10px] text-white">Completed</Badge>
                          ) : (
                            stageStatusBadge(stage.status)
                          )}
                        </div>
                      </div>

                      {status === "assigned" || status === "in_progress" ? (
                        <div className="mt-3 w-full space-y-2 border-t border-border pt-3">
                          {status === "assigned" ? (
                            <Button
                              style={{ backgroundColor: accent, color: "#fff" }}
                              className="w-full text-sm"
                              onClick={async () => {
                                try {
                                  await api.updateMyTaskStatus(itemId, stageId, { status: "in_progress" });
                                  toast.success("Edit started");
                                } catch (error) {
                                  toast.error(error.message || "Failed to start edit");
                                } finally {
                                  await reloadTasks();
                                }
                              }}
                            >
                              Start Edit
                            </Button>
                          ) : null}

                          {status === "in_progress" ? (
                            <>
                              <div className="space-y-1">
                                <p className="text-[10px] leading-tight text-muted-foreground">Edited file link</p>
                                <Input
                                  type="url"
                                  className="h-8 text-xs"
                                  placeholder="Paste edited file URL"
                                  value={draft.editedFileLink}
                                  onChange={(e) =>
                                    setEditDrafts((prev) => ({
                                      ...prev,
                                      [stageId]: { ...draft, editedFileLink: e.target.value },
                                    }))
                                  }
                                />
                              </div>
                              <Button
                                style={{ backgroundColor: accent, color: "#fff" }}
                                className="w-full text-sm"
                                onClick={async () => {
                                  try {
                                    await api.updateMyTaskStatus(itemId, stageId, {
                                      status: "completed",
                                      editedFileLink: draft.editedFileLink,
                                    });
                                    toast.success("Edit submitted");
                                  } catch (error) {
                                    toast.error(error.message || "Failed to submit edit");
                                  } finally {
                                  await reloadTasks();
                                  }
                                }}
                              >
                                Submit Edit
                              </Button>
                            </>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
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
        viewerRole="editor"
        onDidMutate={async () => {
          await reloadTasks();
        }}
      />
    </DashboardShell>
  );
}
