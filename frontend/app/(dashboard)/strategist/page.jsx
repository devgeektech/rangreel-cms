"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, FileText, LayoutDashboard, Rocket, Sparkles } from "lucide-react";
import DashboardShell from "@/components/layout/DashboardShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  { href: "/strategist", label: "Dashboard", icon: LayoutDashboard },
  { href: "/strategist/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/strategist/campaigns", label: "Campaigns", icon: Rocket },
  { href: "/strategist/briefs", label: "Briefs", icon: FileText },
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

export default function StrategistDashboardPage() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [planDrafts, setPlanDrafts] = useState({});
  const [expandedStageId, setExpandedStageId] = useState(null);
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

  const planStages = useMemo(() => {
    const entries = [];
    (tasks || []).forEach((t) => {
      (t.stages || []).forEach((stage) => {
        if (String(stage.stageName).toLowerCase() === "plan") {
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
        <Card className="border-[#0EA5E9]/30 bg-gradient-to-r from-[#0EA5E9]/15 to-transparent">
          <CardContent className="flex items-center justify-between p-6">
            <div>
              <h2 className="text-2xl font-semibold">Strategist Dashboard</h2>
              <p className="mt-1 text-sm text-muted-foreground">Plan, submit, and keep content aligned.</p>
            </div>
            <Sparkles className="h-8 w-8 text-[#0EA5E9]" />
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
            ) : planStages.length === 0 ? (
              <EmptyState
                title="No Plan tasks this month"
                description="You’ll see your Strategist Plan stages here once they’re assigned."
              />
            ) : (
              <div className="space-y-3">
                {planStages.map(({ itemId, title, clientBrand, contentType, stage }) => {
                  const overdue = isWorkflowStageOverdue(stage, todayStartMs);
                  const status = String(stage.status || "").toLowerCase();
                  const completed = isWorkflowStageCompleted(stage, "default");
                  const dueText = stage?.dueDate ? new Date(stage.dueDate).toLocaleDateString() : "-";
                  const stageId = stage._id;
                  const draft = planDrafts[stageId] || {
                    hook: "",
                    concept: "",
                    captionDirection: "",
                    contentBrief: [""],
                  };

                  return (
                    <div key={stageId} className="rounded-lg border border-border p-3">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p
                            className={`text-sm font-semibold ${
                              completed ? "line-through opacity-70" : ""
                            }`}
                            title={title}
                            onClick={() => {
                              if (status === "in_progress") setExpandedStageId(stageId);
                            }}
                            style={{ cursor: status === "in_progress" ? "pointer" : undefined }}
                          >
                            {title}
                          </p>
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
                            <Badge variant="outline">{stage.stageName}</Badge>
                            <span className={overdue ? "text-xs font-medium text-destructive" : "text-xs text-muted-foreground"}>
                              Due: {dueText}
                            </span>
                            {overdue ? <Badge variant="destructive">Overdue</Badge> : null}
                            {completed ? (
                              <Badge className="bg-green-600 text-white">Completed</Badge>
                            ) : (
                              stageStatusBadge(stage.status)
                            )}
                          </div>
                        </div>

                        <div className="flex flex-col items-start gap-2 sm:items-end">
                          {status === "assigned" || status === "planned" ? (
                            <Button
                              onClick={async () => {
                                try {
                                  await api.updateMyTaskStatus(itemId, stageId, { status: "in_progress" });
                                  setExpandedStageId(stageId);
                                  toast.success("Planning started");
                                } catch (error) {
                                  toast.error(error.message || "Failed to start planning");
                                } finally {
                                  const res = await api.getMyTasks(month);
                                  setTasks(Array.isArray(res?.data) ? res.data : []);
                                }
                              }}
                              className="bg-primary"
                            >
                              Start Planning
                            </Button>
                          ) : null}

                          {status === "in_progress" ? (
                            expandedStageId === null || expandedStageId === stageId ? (
                              <div className="w-full sm:w-[360px] space-y-2">
                              <div className="space-y-1">
                                <p className="text-xs text-muted-foreground">Hook</p>
                                <Input
                                  value={draft.hook}
                                  placeholder="Write a strong hook..."
                                  onChange={(e) =>
                                    setPlanDrafts((prev) => ({
                                      ...prev,
                                      [stageId]: { ...draft, hook: e.target.value },
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <p className="text-xs text-muted-foreground">Concept</p>
                                <Input
                                  value={draft.concept}
                                  placeholder="Concept direction..."
                                  onChange={(e) =>
                                    setPlanDrafts((prev) => ({
                                      ...prev,
                                      [stageId]: { ...draft, concept: e.target.value },
                                    }))
                                  }
                                />
                              </div>
                              <div className="space-y-1">
                                <p className="text-xs text-muted-foreground">Caption Direction</p>
                                <Input
                                  value={draft.captionDirection}
                                  placeholder="Caption direction..."
                                  onChange={(e) =>
                                    setPlanDrafts((prev) => ({
                                      ...prev,
                                      [stageId]: { ...draft, captionDirection: e.target.value },
                                    }))
                                  }
                                />
                              </div>

                              <div className="space-y-1.5 pt-1">
                                <p className="text-xs text-muted-foreground">Content points</p>
                                <div className="space-y-2">
                                  {(draft.contentBrief?.length ? draft.contentBrief : [""]).map((point, idx) => (
                                    <div key={idx} className="flex items-center gap-2">
                                      <Input
                                        value={point}
                                        placeholder={`Point ${idx + 1}`}
                                        onChange={(e) => {
                                          const next = [...(draft.contentBrief || [""])];
                                          next[idx] = e.target.value;
                                          setPlanDrafts((prev) => ({
                                            ...prev,
                                            [stageId]: { ...draft, contentBrief: next },
                                          }));
                                        }}
                                      />
                                    </div>
                                  ))}
                                </div>

                                <Button
                                  type="button"
                                  variant="outline"
                                  className="w-full"
                                  onClick={() => {
                                    const next = [...(draft.contentBrief || [""]), ""];
                                    setPlanDrafts((prev) => ({
                                      ...prev,
                                      [stageId]: { ...draft, contentBrief: next },
                                    }));
                                  }}
                                >
                                  + Add
                                </Button>
                              </div>

                              <Button
                                style={{ backgroundColor: accent, color: "#fff" }}
                                className="w-full"
                                onClick={async () => {
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
                                  } catch (error) {
                                    toast.error(error.message || "Failed to submit plan");
                                  } finally {
                                    const res = await api.getMyTasks(month);
                                    setTasks(Array.isArray(res?.data) ? res.data : []);
                                  }
                                }}
                              >
                                Submit Plan
                              </Button>
                            </div>
                            ) : null
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
      />
    </DashboardShell>
  );
}
