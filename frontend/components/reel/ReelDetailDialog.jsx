"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { api, getBaseUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

function CollapsibleSection({ title, defaultOpen = false, className, children, headerExtra }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn("rounded-lg border border-border/80 bg-muted/5", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-t-lg px-3 py-2.5 text-left hover:bg-muted/40"
        aria-expanded={open}
      >
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{title}</span>
        <div className="flex shrink-0 items-center gap-2">
          {headerExtra}
          <ChevronDown
            className={cn("h-4 w-4 text-muted-foreground transition-transform duration-200", open && "rotate-180")}
            aria-hidden
          />
        </div>
      </button>
      {open ? <div className="border-t border-border/60 px-3 pb-3 pt-3">{children}</div> : null}
    </div>
  );
}

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

function contentDetailTitle(contentType) {
  const t = String(contentType || "").toLowerCase();
  if (t === "reel") return "Reel details";
  if (t === "static_post") return "Post details";
  if (t === "carousel") return "Carousel details";
  if (t === "gmb_post") return "GMB post details";
  if (t === "campaign") return "Campaign details";
  return "Content details";
}

/** Strategist plan fields may be HTML (rich text). */
function PlanHtmlBlock({ label, html }) {
  const raw = String(html || "").trim();
  if (!raw) {
    return (
      <div className="space-y-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-sm italic text-muted-foreground">Not provided yet.</p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div
        className="strategist-plan-html rounded-md border border-border bg-muted/20 p-3 text-sm leading-relaxed text-foreground [&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-muted-foreground/30 [&_blockquote]:pl-3 [&_blockquote]:italic [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:list-disc [&_ul]:pl-5"
        dangerouslySetInnerHTML={{ __html: raw }}
      />
    </div>
  );
}

function broadcastTasksUpdated() {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("rr:tasksUpdated", String(Date.now()));
  } catch {
    // ignore
  }
}

/** `/temp/videos/...` is served from the API origin (not `/api`). */
function resolveBackendMediaUrl(pathOrUrl) {
  if (!pathOrUrl) return "";
  const s = String(pathOrUrl).trim();
  if (/^https?:\/\//i.test(s)) return s;
  const origin = getBaseUrl().replace(/\/api\/?$/i, "");
  return `${origin}${s.startsWith("/") ? s : `/${s}`}`;
}

export function ReelDetailDialog({ open, onOpenChange, contentId, viewerRole, onDidMutate }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [mutating, setMutating] = useState(false);
  const [editorVideoUrl, setEditorVideoUrl] = useState("");
  const [editorVideoFile, setEditorVideoFile] = useState(null);
  const [shootFootageLink, setShootFootageLink] = useState("");
  const [shootFootageFile, setShootFootageFile] = useState(null);

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

  const planHook = data?.hook ?? "";
  const planConcept = data?.concept ?? "";
  const planCaption = data?.captionDirection ?? "";
  const contentType = data?.contentType || data?.type || "";

  const planStage = useMemo(() => {
    return stages.find((s) => String(s?.stageName || "").toLowerCase() === "plan") || null;
  }, [stages]);

  const shootStage = useMemo(() => {
    return stages.find((s) => String(s?.stageName || "").toLowerCase() === "shoot") || null;
  }, [stages]);
  const designStage = useMemo(() => {
    return (
      stages.find((s) => {
        const n = String(s?.stageName || "").toLowerCase();
        return n === "design" || n === "work";
      }) || null
    );
  }, [stages]);

  useEffect(() => {
    if (!open) return;
    setShootFootageLink(String(shootStage?.footageLink || ""));
    setShootFootageFile(null);
  }, [open, contentId, shootStage?.footageLink]);

  const showVideographerActions =
    String(viewerRole || "").toLowerCase() === "videographer" && Boolean(shootStage?._id);
  const showEditorActions =
    String(viewerRole || "").toLowerCase() === "editor" &&
    Boolean(stages.find((s) => String(s?.stageName || "").toLowerCase() === "edit")?._id);
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
  const designerSubmittedVideoUrl = String(
    designStage?.videoUrl || designStage?.designFileLink || data?.designFileLink || ""
  ).trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 px-6 pt-6">
          <DialogTitle>{contentDetailTitle(contentType)}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
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
              <CardContent className="space-y-4">
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

                <CollapsibleSection title="Strategist plan">
                  <div className="space-y-3">
                    <PlanHtmlBlock label="Hook" html={planHook} />
                    <PlanHtmlBlock label="Concept" html={planConcept} />
                    <PlanHtmlBlock label="Caption direction" html={planCaption} />
                  </div>
                </CollapsibleSection>

                <CollapsibleSection title="Content points">
                  {contentBrief.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No content points yet.</p>
                  ) : (
                    <ul className="list-disc pl-5 text-sm">
                      {contentBrief.map((p, idx) => (
                        <li key={idx} className="[&_a]:text-primary [&_a]:underline">
                          {/<[a-z][\s\S]*>/i.test(String(p)) ? (
                            <span dangerouslySetInnerHTML={{ __html: String(p) }} />
                          ) : (
                            String(p)
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </CollapsibleSection>

                {shootStage?.footageLink ? (
                  <CollapsibleSection title="Videographer raw footage">
                    <p className="text-xs text-muted-foreground">
                      Submitted for the Shoot stage (link or file uploaded to the server).
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <a
                        href={resolveBackendMediaUrl(shootStage.footageLink)}
                        download
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium text-primary underline underline-offset-2"
                      >
                        Download footage
                      </a>
                    </div>
                    <video
                      className="mt-2 w-full rounded-lg border border-border bg-black"
                      src={resolveBackendMediaUrl(shootStage.footageLink)}
                      controls
                      preload="metadata"
                    />
                  </CollapsibleSection>
                ) : null}

                {data.videoUrl ? (
                  <CollapsibleSection title="Final video (editor)">
                    <video
                      className="w-full rounded-lg border border-border bg-black"
                      src={resolveBackendMediaUrl(data.videoUrl)}
                      controls
                      preload="metadata"
                    />
                  </CollapsibleSection>
                ) : null}
                {designStage?._id || designerSubmittedVideoUrl ? (
                  <CollapsibleSection title="Graphic designer submission">
                    <p className="text-sm text-muted-foreground">
                      Status:{" "}
                      <span className="text-foreground">
                        {String(designStage?.status || (designerSubmittedVideoUrl ? "completed" : "-"))}
                      </span>
                    </p>
                    {designerSubmittedVideoUrl ? (
                      <div className="mt-2 space-y-2">
                        <a
                          href={resolveBackendMediaUrl(designerSubmittedVideoUrl)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-medium text-primary underline underline-offset-2"
                        >
                          Open submitted video
                        </a>
                        <video
                          className="w-full rounded-lg border border-border bg-black"
                          src={resolveBackendMediaUrl(designerSubmittedVideoUrl)}
                          controls
                          preload="metadata"
                        />
                      </div>
                    ) : (
                      <p className="mt-1 text-sm italic text-muted-foreground">No submission yet.</p>
                    )}
                  </CollapsibleSection>
                ) : null}
              </CardContent>
            </Card>

            {approvalStage?._id ? (
              <CollapsibleSection title="Manager approval">
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground">
                    Approval status: <span className="text-foreground">{String(approvalStage.status || "-")}</span>
                  </div>
                  {approvalStage?.rejectionNote ? (
                    <p className="text-xs text-destructive">{approvalStage.rejectionNote}</p>
                  ) : null}

                  {showManagerActions ? (
                    <>
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
                    </>
                  ) : null}
                </div>
              </CollapsibleSection>
            ) : null}

            {postStage?._id ? (
              <CollapsibleSection title="Posting">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-muted-foreground">
                    Post status: <span className="text-foreground">{String(postStage?.status || "-")}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {showPostingActions &&
                    (String(postStage?.status || "").toLowerCase() === "assigned" ||
                      String(postStage?.status || "").toLowerCase() === "planned") ? (
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
                </div>
              </CollapsibleSection>
            ) : null}

            {shootStage?._id ? (
              <CollapsibleSection title="Shoot">
                <div className="space-y-3">
                  <div className="text-sm text-muted-foreground">
                    Status: <span className="text-foreground">{String(shootStage?.status || "-")}</span>
                  </div>
                  {shootStage?.footageLink ? (
                    <p className="text-xs">
                      <a
                        href={resolveBackendMediaUrl(shootStage.footageLink)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-primary underline underline-offset-2"
                      >
                        Open submitted footage
                      </a>
                    </p>
                  ) : null}

                  {showVideographerActions &&
                  String(shootStage?.status || "").toLowerCase() === "assigned" ? (
                    <div className="flex flex-wrap gap-2">
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
                    </div>
                  ) : null}

                  {showVideographerActions &&
                  String(shootStage?.status || "").toLowerCase() === "in_progress" ? (
                    <div className="space-y-3 rounded-lg border border-border/60 bg-muted/5 p-3">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Footage link (optional if you upload a file)</p>
                        <Input
                          type="url"
                          placeholder="Paste footage URL (Drive/Dropbox/etc.)"
                          value={shootFootageLink}
                          onChange={(e) => setShootFootageLink(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Upload video (saved under server temp)</p>
                        <Input
                          type="file"
                          accept="video/*"
                          disabled={mutating}
                          onChange={(e) => setShootFootageFile(e.target.files?.[0] || null)}
                        />
                      </div>
                      <Button
                        type="button"
                        disabled={mutating}
                        className="w-full sm:w-auto"
                        onClick={async () => {
                          const trimmed = shootFootageLink.trim();
                          const file = shootFootageFile;
                          if (!trimmed && !file) {
                            toast.error("Add a footage link or upload a video file.");
                            return;
                          }
                          try {
                            setMutating(true);
                            let footageLink = trimmed;
                            if (file) {
                              const resBody = await api.uploadVideo(file);
                              const path = resBody?.data?.videoUrl ?? resBody?.videoUrl ?? "";
                              if (!path) throw new Error("Upload did not return a file URL");
                              footageLink = path;
                            }
                            await api.updateMyTaskStatus(contentId, shootStage._id, {
                              status: "completed",
                              footageLink,
                            });
                            toast.success("Shoot completed — footage saved");
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
                        {mutating ? "Uploading…" : "Submit footage & complete"}
                      </Button>
                    </div>
                  ) : null}

                  {isCompletedLike(shootStage?.status) ? (
                    <Badge className="bg-green-600 text-white">Shoot completed</Badge>
                  ) : null}
                </div>
              </CollapsibleSection>
            ) : null}

            {editStage?._id || data.videoUrl ? (
              <CollapsibleSection title="Editor — final video">
                <div className="space-y-3">
                  {data.videoUrl ? (
                    <video
                      className="w-full rounded-lg border border-border bg-black"
                      src={resolveBackendMediaUrl(data.videoUrl)}
                      controls
                      preload="metadata"
                    />
                  ) : null}
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Video URL</p>
                    <Input
                      type="url"
                      placeholder="Paste final video URL (Drive/S3/CDN)"
                      value={editorVideoUrl}
                      onChange={(e) => setEditorVideoUrl(e.target.value)}
                      disabled={!showEditorActions}
                    />
                  </div>

                  {showEditorActions ? (
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
                  ) : null}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm text-muted-foreground">
                      Edit status: <span className="text-foreground">{String(editStage?.status || "-")}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {showEditorActions && String(editStage?.status || "").toLowerCase() === "assigned" ? (
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

                      {showEditorActions && String(editStage?.status || "").toLowerCase() === "in_progress" ? (
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
                </div>
              </CollapsibleSection>
            ) : null}

            <CollapsibleSection title="Stage timeline">
              <div className="space-y-2">
                {stages.map((s, idx) => {
                  const prev = idx > 0 ? stages[idx - 1] : null;
                  const prevDone = prev?.completedAt ? safeYMD(prev.completedAt) : null;
                  const stageTitle = `${s.stageName} (${s.role})`;
                  return (
                    <CollapsibleSection
                      key={s._id || idx}
                      title={stageTitle}
                      headerExtra={stageStatusBadge(s.status)}
                      defaultOpen={false}
                      className="bg-muted/10"
                    >
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
                      {String(s.stageName || "").toLowerCase() === "shoot" && s.footageLink ? (
                        <p className="mt-1 text-xs">
                          <a
                            href={resolveBackendMediaUrl(s.footageLink)}
                            target="_blank"
                            rel="noreferrer"
                            className="font-medium text-primary underline underline-offset-2"
                          >
                            Raw footage
                          </a>
                        </p>
                      ) : null}
                      {s.assignedUser?.name ? (
                        <p className="mt-2 text-xs text-muted-foreground">Assigned: {s.assignedUser.name}</p>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">Assigned: -</p>
                      )}
                    </CollapsibleSection>
                  );
                })}
              </div>
            </CollapsibleSection>
          </div>
        )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

