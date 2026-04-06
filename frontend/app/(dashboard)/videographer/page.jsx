"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, CalendarClock, LayoutDashboard, ListTodo, Upload } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { api } from "@/lib/api";
import EmptyState from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { TaskMonthControls } from "@/components/role-dashboard/TaskMonthControls";
import { ReelDetailDialog } from "@/components/reel/ReelDetailDialog";
import {
  getTodayStartMs,
  isWorkflowStageCompleted,
  isWorkflowStageOverdue,
} from "@/lib/roleDashboardTasks";

const navItems = [
  { href: "/videographer", label: "Dashboard", icon: LayoutDashboard },
  { href: "/videographer/schedule", label: "Schedule", icon: CalendarClock },
  { href: "/videographer/tasks", label: "Tasks", icon: ListTodo },
  { href: "/videographer/uploads", label: "Uploads", icon: Upload },
];

const accent = "#F59E0B";

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

export default function VideographerDashboardPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [footageDrafts, setFootageDrafts] = useState({});
  const [footageUploading, setFootageUploading] = useState({});
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

  const shootStages = useMemo(() => {
    const entries = [];
    (tasks || []).forEach((t) => {
      (t.stages || []).forEach((stage) => {
        if (String(stage.stageName).toLowerCase() === "shoot") {
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

  const todayStartMs = useMemo(() => getTodayStartMs(), []);

  return (
    <DashboardShell navItems={navItems}>
      <section className="space-y-6">
        <Card className="border-[#F59E0B]/30 bg-gradient-to-r from-[#F59E0B]/15 to-transparent">
          <CardContent className="flex items-center justify-between p-6">
            <div>
              <h2 className="text-2xl font-semibold">Videographer Dashboard</h2>
              <p className="mt-1 text-sm text-muted-foreground">Manage shoots and submit footage.</p>
            </div>
            <Camera className="h-8 w-8 text-[#F59E0B]" />
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="text-base">My tasks</CardTitle>
              <TaskMonthControls month={month} onMonthChange={setMonth} accent={accent} />
            </div>
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
            ) : shootStages.length === 0 ? (
              <EmptyState
                title="No Shoot stages this month"
                description="You’ll see your Videographer tasks once they’re assigned."
              />
            ) : (
              <div className="space-y-3">
                {shootStages.map(({ itemId, title, clientBrand, contentType, stage }) => {
                  const stageId = stage._id;
                  const status = String(stage.status || "").toLowerCase();
                  const overdue = isWorkflowStageOverdue(stage, todayStartMs);
                  const completed = isWorkflowStageCompleted(stage, "default");
                  const dueText = stage?.dueDate ? new Date(stage.dueDate).toLocaleDateString() : "-";
                  const draft = footageDrafts[stageId] || { footageLink: "", footageFile: null };
                  const uploading = Boolean(footageUploading[stageId]);

                  return (
                    <div key={stageId} className="rounded-lg border border-border p-3">
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-6 lg:gap-4 lg:items-start">
                        <div className="min-w-0 lg:col-span-4">
                          <p className={`text-sm font-semibold ${completed ? "line-through opacity-70" : ""}`}>{title}</p>
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
                            <Badge variant="outline">Shoot</Badge>
                            <span className={overdue ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>
                              Due: {dueText}
                            </span>
                            {overdue ? <Badge variant="destructive">Overdue</Badge> : null}
                            {completed ? <Badge className="bg-green-600 text-white">Completed</Badge> : stageStatusBadge(stage.status)}
                          </div>
                        </div>

                        <div className="w-full space-y-2 lg:col-span-2 lg:col-start-5">
                          {status === "assigned" ? (
                            <Button
                              style={{ backgroundColor: accent, color: "#fff" }}
                              className="w-full"
                              onClick={async () => {
                                try {
                                  await api.updateMyTaskStatus(itemId, stageId, { status: "in_progress" });
                                  toast.success("Shoot started");
                                } catch (error) {
                                  toast.error(error.message || "Failed to start shoot");
                                } finally {
                                  const res = await api.getMyTasks(month);
                                  setTasks(Array.isArray(res?.data) ? res.data : []);
                                }
                              }}
                            >
                              Start Shoot
                            </Button>
                          ) : null}

                          {status === "in_progress" ? (
                            <>
                              <div className="space-y-1">
                                <p className="text-xs text-muted-foreground">Footage link (optional if you upload a file)</p>
                                <Input
                                  type="url"
                                  placeholder="Paste footage URL (Drive/Dropbox/etc.)"
                                  value={draft.footageLink}
                                  onChange={(e) =>
                                    setFootageDrafts((prev) => ({
                                      ...prev,
                                      [stageId]: { ...draft, footageLink: e.target.value },
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <p className="text-xs text-muted-foreground">Upload video file (stored on server)</p>
                                <Input
                                  type="file"
                                  accept="video/*"
                                  disabled={uploading}
                                  onChange={(e) =>
                                    setFootageDrafts((prev) => ({
                                      ...prev,
                                      [stageId]: {
                                        ...draft,
                                        footageFile: e.target.files?.[0] || null,
                                      },
                                    }))
                                  }
                                />
                                <p className="text-[11px] text-muted-foreground">
                                  Saved under server temp; editors can download from View reel details.
                                </p>
                              </div>
                              <Button
                                style={{ backgroundColor: accent, color: "#fff" }}
                                className="w-full"
                                disabled={uploading}
                                onClick={async () => {
                                  const trimmed = String(draft.footageLink || "").trim();
                                  const file = draft.footageFile;
                                  if (!trimmed && !file) {
                                    toast.error("Add a footage link or upload a video file.");
                                    return;
                                  }
                                  try {
                                    setFootageUploading((prev) => ({ ...prev, [stageId]: true }));
                                    let footageLink = trimmed;
                                    if (file) {
                                      const resBody = await api.uploadVideo(file);
                                      const path =
                                        resBody?.data?.videoUrl ?? resBody?.videoUrl ?? "";
                                      if (!path) throw new Error("Upload did not return a file URL");
                                      footageLink = path;
                                    }
                                    await api.updateMyTaskStatus(itemId, stageId, {
                                      status: "completed",
                                      footageLink,
                                    });
                                    toast.success("Footage submitted");
                                    setFootageDrafts((prev) => ({
                                      ...prev,
                                      [stageId]: { footageLink: "", footageFile: null },
                                    }));
                                  } catch (error) {
                                    toast.error(error.message || "Failed to submit footage");
                                  } finally {
                                    setFootageUploading((prev) => ({ ...prev, [stageId]: false }));
                                    const res = await api.getMyTasks(month);
                                    setTasks(Array.isArray(res?.data) ? res.data : []);
                                  }
                                }}
                              >
                                {uploading ? "Uploading…" : "Submit Footage"}
                              </Button>
                            </>
                          ) : null}
                        </div>
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
        viewerRole="videographer"
        onDidMutate={async () => {
          const res = await api.getMyTasks(month);
          setTasks(Array.isArray(res?.data) ? res.data : []);
        }}
      />
    </DashboardShell>
  );
}
