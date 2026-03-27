"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

function stageStatusBadge(status) {
  const s = String(status || "").toLowerCase();
  if (s === "approved") return <Badge className="bg-emerald-600 text-white">Approved</Badge>;
  if (s === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  if (s === "completed") return <Badge className="bg-green-600 text-white">Completed</Badge>;
  if (s === "in_progress") return <Badge variant="outline">In progress</Badge>;
  if (s === "assigned" || s === "planned") return <Badge variant="outline">Assigned</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

function safeYMD(date) {
  if (!date) return "-";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toISOString().slice(0, 10);
}

function isCompletedLike(status) {
  const s = String(status || "").toLowerCase();
  return s === "completed" || s === "approved";
}

function broadcastTasksUpdated() {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("rr:tasksUpdated", String(Date.now()));
  } catch {
    // ignore
  }
}

export function ReelDetailDialog({ open, onOpenChange, contentId, viewerRole, onDidMutate }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [mutating, setMutating] = useState(false);
  const [editorVideoUrl, setEditorVideoUrl] = useState("");
  const [editorVideoFile, setEditorVideoFile] = useState(null);

  const load = async () => {
    if (!contentId) return;
    try {
      setLoading(true);
      const res = await api.getContent(contentId);
      setData(res?.data || null);
    } catch (err) {
      toast.error(err.message || "Failed to load reel details");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contentId]);

  useEffect(() => {
    if (!open) return;
    setEditorVideoUrl(String(data?.videoUrl || ""));
    setEditorVideoFile(null);
  }, [open, data?.videoUrl]);

  const stages = useMemo(() => {
    return Array.isArray(data?.stages) ? data.stages : [];
  }, [data]);

  const contentBrief = useMemo(() => {
    return Array.isArray(data?.contentBrief) ? data.contentBrief : [];
  }, [data]);

  const planStage = useMemo(() => {
    return stages.find((s) => String(s?.stageName || "").toLowerCase() === "plan") || null;
  }, [stages]);

  const shootStage = useMemo(() => {
    return stages.find((s) => String(s?.stageName || "").toLowerCase() === "shoot") || null;
  }, [stages]);

  const showVideographerActions = String(viewerRole || "").toLowerCase() === "videographer" && Boolean(shootStage?._id);
  const showEditorActions = String(viewerRole || "").toLowerCase() === "editor" && Boolean(stages.find((s) => String(s?.stageName || "").toLowerCase() === "edit")?._id);
  const editStage = useMemo(() => {
    return stages.find((s) => String(s?.stageName || "").toLowerCase() === "edit") || null;
  }, [stages]);
  const showManagerActions = String(viewerRole || "").toLowerCase() === "manager";
  const approvalStage = useMemo(() => {
    return stages.find((s) => {
      const n = String(s?.stageName || "").toLowerCase();
      return n === "approval" || n === "approve";
    }) || null;
  }, [stages]);
  const [managerRejectNote, setManagerRejectNote] = useState("");
  useEffect(() => {
    if (!open) return;
    setManagerRejectNote("");
  }, [open, contentId]);

  const showPostingActions = String(viewerRole || "").toLowerCase() === "postingexecutive";
  const postStage = useMemo(() => {
    return stages.find((s) => String(s?.stageName || "").toLowerCase() === "post") || null;
  }, [stages]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reel details</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : !data ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">No data.</p>
            <div className="flex justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{data.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {String(data?.planType || "").toLowerCase() === "urgent" ? (
                    <Badge className="bg-red-600 text-white">Urgent Plan</Badge>
                  ) : (
                    <Badge variant="outline">Normal Plan</Badge>
                  )}
                  <Badge variant="outline">Strategist</Badge>
                  {isCompletedLike(planStage?.status) ? (
                    <Badge className="bg-green-600 text-white">Strategist completed</Badge>
                  ) : (
                    <Badge variant="outline">Strategist not completed</Badge>
                  )}
                </div>

                <p className="text-xs font-medium text-muted-foreground">Content brief</p>
                {contentBrief.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No content points yet.</p>
                ) : (
                  <ul className="list-disc pl-5 text-sm">
                    {contentBrief.map((p, idx) => (
                      <li key={idx}>{p}</li>
                    ))}
                  </ul>
                )}

                {data.videoUrl ? (
                  <div className="pt-2">
                    <p className="text-xs font-medium text-muted-foreground">Video</p>
                    <video
                      className="mt-2 w-full rounded-lg border border-border bg-black"
                      src={data.videoUrl}
                      controls
                      preload="metadata"
                    />
                  </div>
                ) : null}
              </CardContent>
            </Card>

            {showManagerActions && approvalStage?._id ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Manager approval</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-sm text-muted-foreground">
                    Approval status: <span className="text-foreground">{String(approvalStage.status || "-")}</span>
                  </div>

                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Rejection note (optional)</p>
                    <Input
                      placeholder="Reason for rejection"
                      value={managerRejectNote}
                      onChange={(e) => setManagerRejectNote(e.target.value)}
                    />
                  </div>

                  <div className="flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={mutating}
                      onClick={async () => {
                        try {
                          setMutating(true);
                          await api.updateStageStatus(contentId, approvalStage._id, { status: "approved" });
                          toast.success("Approved");
                          await load();
                          onDidMutate?.();
                          broadcastTasksUpdated();
                        } catch (err) {
                          toast.error(err.message || "Failed to approve");
                        } finally {
                          setMutating(false);
                        }
                      }}
                    >
                      Approve
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={mutating}
                      onClick={async () => {
                        try {
                          setMutating(true);
                          await api.updateStageStatus(contentId, approvalStage._id, {
                            status: "rejected",
                            rejectionNote: managerRejectNote,
                          });
                          toast.success("Rejected");
                          await load();
                          onDidMutate?.();
                          broadcastTasksUpdated();
                        } catch (err) {
                          toast.error(err.message || "Failed to reject");
                        } finally {
                          setMutating(false);
                        }
                      }}
                    >
                      Reject
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {showPostingActions && postStage?._id ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Posting</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-muted-foreground">
                    Post status: <span className="text-foreground">{String(postStage?.status || "-")}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {String(postStage?.status || "").toLowerCase() === "assigned" ||
                    String(postStage?.status || "").toLowerCase() === "planned" ? (
                      <Button
                        type="button"
                        disabled={mutating}
                        onClick={async () => {
                          try {
                            setMutating(true);
                            // Lifecycle is assigned -> in_progress -> completed
                            if (String(postStage.status || "").toLowerCase() !== "in_progress") {
                              await api.updateMyTaskStatus(contentId, postStage._id, { status: "in_progress" });
                            }
                            await api.updateMyTaskStatus(contentId, postStage._id, { status: "completed" });
                            toast.success("Marked as posted");
                            await load();
                            onDidMutate?.();
                            broadcastTasksUpdated();
                          } catch (err) {
                            toast.error(err.message || "Failed to mark as posted");
                          } finally {
                            setMutating(false);
                          }
                        }}
                      >
                        Mark as Posted
                      </Button>
                    ) : null}
                    {isCompletedLike(postStage?.status) ? (
                      <Badge className="bg-green-600 text-white">Posted</Badge>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {showVideographerActions ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Shoot</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-muted-foreground">
                    Status: <span className="text-foreground">{String(shootStage?.status || "-")}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {String(shootStage?.status || "").toLowerCase() === "assigned" ? (
                      <Button
                        type="button"
                        disabled={mutating}
                        onClick={async () => {
                          try {
                            setMutating(true);
                            await api.updateMyTaskStatus(contentId, shootStage._id, { status: "in_progress" });
                            toast.success("Shoot started");
                            await load();
                            onDidMutate?.();
                            broadcastTasksUpdated();
                          } catch (err) {
                            toast.error(err.message || "Failed to start shoot");
                          } finally {
                            setMutating(false);
                          }
                        }}
                      >
                        Start
                      </Button>
                    ) : null}

                    {String(shootStage?.status || "").toLowerCase() === "in_progress" ? (
                      <Button
                        type="button"
                        disabled={mutating}
                        onClick={async () => {
                          try {
                            setMutating(true);
                            await api.updateMyTaskStatus(contentId, shootStage._id, { status: "completed" });
                            toast.success("Shoot completed");
                            await load();
                            onDidMutate?.();
                            broadcastTasksUpdated();
                          } catch (err) {
                            toast.error(err.message || "Failed to complete shoot");
                          } finally {
                            setMutating(false);
                          }
                        }}
                      >
                        Complete
                      </Button>
                    ) : null}

                    {isCompletedLike(shootStage?.status) ? (
                      <Badge className="bg-green-600 text-white">Shoot completed</Badge>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {showEditorActions ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Editor — final video</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Video URL</p>
                    <Input
                      type="url"
                      placeholder="Paste final video URL (Drive/S3/CDN)"
                      value={editorVideoUrl}
                      onChange={(e) => setEditorVideoUrl(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Or upload file (temp)</p>
                    <Input
                      type="file"
                      accept="video/*"
                      onChange={(e) => setEditorVideoFile(e.target.files?.[0] || null)}
                    />
                    <div className="flex items-center justify-end">
                      <Button
                        type="button"
                        variant="outline"
                        disabled={mutating || !editorVideoFile}
                        onClick={async () => {
                          try {
                            setMutating(true);
                            const res = await api.uploadVideo(editorVideoFile);
                            const url = res?.data?.videoUrl || res?.videoUrl || "";
                            if (!url) throw new Error("Upload did not return videoUrl");
                            setEditorVideoUrl(url);
                            toast.success("Uploaded");
                          } catch (err) {
                            toast.error(err.message || "Upload failed");
                          } finally {
                            setMutating(false);
                          }
                        }}
                      >
                        Upload
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm text-muted-foreground">
                      Edit status: <span className="text-foreground">{String(editStage?.status || "-")}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {String(editStage?.status || "").toLowerCase() === "assigned" ? (
                        <Button
                          type="button"
                          disabled={mutating}
                          onClick={async () => {
                            try {
                              setMutating(true);
                              await api.updateMyTaskStatus(contentId, editStage._id, { status: "in_progress" });
                              toast.success("Edit started");
                              await load();
                              onDidMutate?.();
                              broadcastTasksUpdated();
                            } catch (err) {
                              toast.error(err.message || "Failed to start edit");
                            } finally {
                              setMutating(false);
                            }
                          }}
                        >
                          Start
                        </Button>
                      ) : null}

                      {String(editStage?.status || "").toLowerCase() === "in_progress" ? (
                        <Button
                          type="button"
                          disabled={mutating}
                          onClick={async () => {
                            try {
                              setMutating(true);
                              await api.updateMyTaskStatus(contentId, editStage._id, {
                                status: "completed",
                                videoUrl: editorVideoUrl,
                              });
                              toast.success("Edit submitted");
                              await load();
                              onDidMutate?.();
                              broadcastTasksUpdated();
                            } catch (err) {
                              toast.error(err.message || "Failed to submit edit");
                            } finally {
                              setMutating(false);
                            }
                          }}
                        >
                          Submit (Complete)
                        </Button>
                      ) : null}

                      {isCompletedLike(editStage?.status) ? (
                        <Badge className="bg-green-600 text-white">Edit completed</Badge>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Stage timeline</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {stages.map((s, idx) => {
                  const prev = idx > 0 ? stages[idx - 1] : null;
                  const prevDone = prev?.completedAt ? safeYMD(prev.completedAt) : null;
                  return (
                    <div key={s._id || idx} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold">
                            {s.stageName}{" "}
                            <span className="text-xs font-normal text-muted-foreground">({s.role})</span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Due: {safeYMD(s.dueDate)}
                            {s.completedAt ? ` • Completed: ${safeYMD(s.completedAt)}` : ""}
                          </p>
                          {prevDone ? (
                            <p className="text-xs text-muted-foreground">Prev completed: {prevDone}</p>
                          ) : null}
                          {s.rejectionNote ? (
                            <p className="mt-1 text-xs text-destructive">{s.rejectionNote}</p>
                          ) : null}
                        </div>
                        <div className="shrink-0">{stageStatusBadge(s.status)}</div>
                      </div>
                      {s.assignedUser?.name ? (
                        <p className="mt-2 text-xs text-muted-foreground">Assigned: {s.assignedUser.name}</p>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">Assigned: -</p>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

