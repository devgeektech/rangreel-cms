"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function normalizeRole(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

export default function SharedContentPage({ params }) {
  const id = params?.id;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mutating, setMutating] = useState(false);
  const [managerRejectNote, setManagerRejectNote] = useState("");
  const [shootFootageLink, setShootFootageLink] = useState("");
  const [shootFootageFile, setShootFootageFile] = useState(null);
  const [editorVideoUrl, setEditorVideoUrl] = useState("");
  const [editorVideoFile, setEditorVideoFile] = useState(null);
  const [designerVideoUrl, setDesignerVideoUrl] = useState("");
  const [designerVideoFile, setDesignerVideoFile] = useState(null);
  const [planHook, setPlanHook] = useState("");
  const [planConcept, setPlanConcept] = useState("");
  const [planCaptionDirection, setPlanCaptionDirection] = useState("");
  const [planContentBrief, setPlanContentBrief] = useState([""]);
  const [resolvedUserRole, setResolvedUserRole] = useState("");
  const user = useAuthStore((state) => state.user);

  const loadData = async () => {
    if (!id) return;
    setLoading(true);
    setError("");
    try {
      // Share endpoint resolves auth + id fallback; full details endpoint enables role actions.
      const shared = await api.getSharedContent(id);
      const resolvedId = shared?.data?._id || id;
      const full = await api.getContent(resolvedId);
      setData(full?.data || null);
    } catch (err) {
      setError(err?.message || "Failed to load content details");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;

    const fetchData = async () => {
      await loadData();
    };

    fetchData();
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    let active = true;
    const hydrateRole = async () => {
      const fromStore = normalizeRole(user?.role?.slug || user?.roleType || user?.role);
      if (fromStore) {
        setResolvedUserRole(fromStore);
        return;
      }
      try {
        const me = await api.getMe();
        if (!active) return;
        const fromApi = normalizeRole(
          me?.user?.role?.slug || me?.user?.roleType || me?.user?.role
        );
        if (fromApi) setResolvedUserRole(fromApi);
      } catch {
        // leave empty; UI remains read-only until role is known
      }
    };
    hydrateRole();
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    const stages = Array.isArray(data?.stages) ? data.stages : [];
    const shootStage = stages.find((s) => normalizeRole(s?.stageName) === "shoot");
    const planStage = stages.find((s) => normalizeRole(s?.stageName) === "plan");
    setShootFootageLink(String(shootStage?.footageLink || ""));
    setShootFootageFile(null);
    setEditorVideoUrl(String(data?.videoUrl || ""));
    setEditorVideoFile(null);
    const designStage = stages.find((s) => {
      const n = normalizeRole(s?.stageName);
      return n === "design" || n === "work";
    });
    const existingDesignerUrl = String(
      designStage?.videoUrl || designStage?.designFileLink || data?.designFileLink || ""
    ).trim();
    setDesignerVideoUrl(existingDesignerUrl);
    setDesignerVideoFile(null);
    setPlanHook(String(data?.hook || ""));
    setPlanConcept(String(data?.concept || ""));
    setPlanCaptionDirection(String(data?.captionDirection || ""));
    setPlanContentBrief(
      Array.isArray(planStage?.contentBrief) && planStage.contentBrief.length
        ? planStage.contentBrief.map((x) => String(x))
        : Array.isArray(data?.contentBrief) && data.contentBrief.length
          ? data.contentBrief.map((x) => String(x))
          : [""]
    );
  }, [data]);

  const currentRole = useMemo(() => {
    const raw = normalizeRole(resolvedUserRole || user?.role?.slug || user?.roleType || user?.role);
    if (raw === "posting") return "postingexecutive";
    if (raw === "campaign-manager") return "manager";
    if (raw === "designer") return "graphicdesigner";
    return raw;
  }, [resolvedUserRole, user]);

  const stages = useMemo(() => (Array.isArray(data?.stages) ? data.stages : []), [data]);
  const planStage = useMemo(
    () => stages.find((s) => normalizeRole(s?.stageName) === "plan") || null,
    [stages]
  );
  const shootStage = useMemo(
    () => stages.find((s) => normalizeRole(s?.stageName) === "shoot") || null,
    [stages]
  );
  const editStage = useMemo(
    () => stages.find((s) => normalizeRole(s?.stageName) === "edit") || null,
    [stages]
  );
  const designStage = useMemo(
    () =>
      stages.find((s) => {
        const n = normalizeRole(s?.stageName);
        return n === "design" || n === "work";
      }) || null,
    [stages]
  );
  const approvalStage = useMemo(
    () =>
      stages.find((s) => {
        const n = normalizeRole(s?.stageName);
        return n === "approval" || n === "approve";
      }) || null,
    [stages]
  );
  const postStage = useMemo(
    () => stages.find((s) => normalizeRole(s?.stageName) === "post") || null,
    [stages]
  );

  const isCompletedLike = (status) => {
    const s = normalizeRole(status);
    return s === "completed" || s === "approved";
  };

  const resolveMediaUrl = (value) => {
    const s = String(value || "").trim();
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) return s;
    const base = String(process.env.NEXT_PUBLIC_API_URL || "").replace(/\/api\/?$/, "");
    return `${base}${s.startsWith("/") ? s : `/${s}`}`;
  };

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading...</div>;
  }

  if (error) {
    return <div className="p-6 text-sm text-destructive">{error}</div>;
  }

  if (!data) {
    return <div className="p-6 text-sm text-muted-foreground">Not found</div>;
  }

  return (
    <div className="p-6">
      <Card className="mx-auto w-full max-w-3xl">
        <CardHeader className="space-y-2">
          <CardTitle className="text-xl">{data.displayId || data.title}</CardTitle>
          <p className="text-xs text-muted-foreground">
            {data.displayId ? `Task ID: ${data.displayId}` : ""}
            {data.displayId && data.title ? " • " : ""}
            {data.title ? `Title: ${data.title}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {String(data?.planType || "").toLowerCase() === "urgent" ? (
              <Badge className="bg-red-600 text-white">Urgent Plan</Badge>
            ) : (
              <Badge variant="outline">Normal Plan</Badge>
            )}
            {data?.contentType ? <Badge variant="outline">{data.contentType}</Badge> : null}
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <section className="space-y-2">
            <h2 className="font-semibold">Strategist Plan</h2>
            <div className="grid gap-2">
              <Input
                value={planHook}
                onChange={(e) => setPlanHook(e.target.value)}
                placeholder="Hook"
                disabled={currentRole !== "strategist"}
              />
              <Input
                value={planConcept}
                onChange={(e) => setPlanConcept(e.target.value)}
                placeholder="Concept"
                disabled={currentRole !== "strategist"}
              />
              <Input
                value={planCaptionDirection}
                onChange={(e) => setPlanCaptionDirection(e.target.value)}
                placeholder="Caption direction"
                disabled={currentRole !== "strategist"}
              />
              <Input
                value={(planContentBrief || []).join(" | ")}
                onChange={(e) =>
                  setPlanContentBrief(
                    String(e.target.value || "")
                      .split("|")
                      .map((x) => x.trim())
                      .filter(Boolean)
                  )
                }
                placeholder="Content brief points separated by |"
                disabled={currentRole !== "strategist"}
              />
            </div>
            {currentRole === "strategist" && planStage?._id ? (
              <div className="flex flex-wrap gap-2">
                {(normalizeRole(planStage?.status) === "assigned" ||
                  normalizeRole(planStage?.status) === "planned") && (
                  <Button
                    type="button"
                    disabled={mutating}
                    onClick={async () => {
                      try {
                        setMutating(true);
                        await api.updateMyTaskStatus(data._id, planStage._id, { status: "in_progress" });
                        toast.success("Planning started");
                        await loadData();
                      } catch (e) {
                        toast.error(e?.message || "Failed to start planning");
                      } finally {
                        setMutating(false);
                      }
                    }}
                  >
                    Start Planning
                  </Button>
                )}
                {normalizeRole(planStage?.status) === "in_progress" && (
                  <Button
                    type="button"
                    disabled={mutating}
                    onClick={async () => {
                      try {
                        setMutating(true);
                        await api.updateMyTaskStatus(data._id, planStage._id, {
                          status: "completed",
                          hook: planHook,
                          concept: planConcept,
                          captionDirection: planCaptionDirection,
                          contentBrief: planContentBrief,
                        });
                        toast.success("Plan submitted");
                        await loadData();
                      } catch (e) {
                        toast.error(e?.message || "Failed to submit plan");
                      } finally {
                        setMutating(false);
                      }
                    }}
                  >
                    Submit Plan
                  </Button>
                )}
              </div>
            ) : null}
          </section>

          {shootStage?._id && (
            <section className="space-y-2">
              <h2 className="font-semibold">Shoot</h2>
              {currentRole === "videographer" && (
                <div className="grid gap-2">
                  <Input
                    placeholder="Footage link"
                    value={shootFootageLink}
                    onChange={(e) => setShootFootageLink(e.target.value)}
                  />
                  <Input
                    type="file"
                    accept="video/*"
                    onChange={(e) => setShootFootageFile(e.target.files?.[0] || null)}
                  />
                </div>
              )}
              {normalizeRole(shootStage?.status) === "assigned" && currentRole === "videographer" ? (
                <Button
                  type="button"
                  disabled={mutating}
                  onClick={async () => {
                    try {
                      setMutating(true);
                      await api.updateMyTaskStatus(data._id, shootStage._id, { status: "in_progress" });
                      toast.success("Shoot started");
                      await loadData();
                    } catch (e) {
                      toast.error(e?.message || "Failed to start shoot");
                    } finally {
                      setMutating(false);
                    }
                  }}
                >
                  Start Shoot
                </Button>
              ) : null}
              {normalizeRole(shootStage?.status) === "in_progress" && currentRole === "videographer" ? (
                <Button
                  type="button"
                  disabled={mutating}
                  onClick={async () => {
                    try {
                      setMutating(true);
                      let footageLink = String(shootFootageLink || "").trim();
                      if (shootFootageFile) {
                        const upload = await api.uploadVideo(shootFootageFile);
                        footageLink = upload?.data?.videoUrl || upload?.videoUrl || footageLink;
                      }
                      await api.updateMyTaskStatus(data._id, shootStage._id, {
                        status: "completed",
                        footageLink,
                      });
                      toast.success("Shoot completed");
                      await loadData();
                    } catch (e) {
                      toast.error(e?.message || "Failed to complete shoot");
                    } finally {
                      setMutating(false);
                    }
                  }}
                >
                  Submit Footage
                </Button>
              ) : null}
            </section>
          )}

          {(editStage?._id || data?.videoUrl) && (
            <section className="space-y-2">
              <h2 className="font-semibold">Editor</h2>
              <Input
                placeholder="Final video URL"
                value={editorVideoUrl}
                onChange={(e) => setEditorVideoUrl(e.target.value)}
                disabled={currentRole !== "editor"}
              />
              {currentRole === "editor" ? (
                <Input
                  type="file"
                  accept="video/*"
                  onChange={(e) => setEditorVideoFile(e.target.files?.[0] || null)}
                />
              ) : null}
              {data?.videoUrl ? (
                <video
                  src={resolveMediaUrl(data.videoUrl)}
                  controls
                  className="w-full rounded-md border bg-black/10"
                />
              ) : null}
              {normalizeRole(editStage?.status) === "assigned" && currentRole === "editor" ? (
                <Button
                  type="button"
                  disabled={mutating}
                  onClick={async () => {
                    try {
                      setMutating(true);
                      await api.updateMyTaskStatus(data._id, editStage._id, { status: "in_progress" });
                      toast.success("Edit started");
                      await loadData();
                    } catch (e) {
                      toast.error(e?.message || "Failed to start edit");
                    } finally {
                      setMutating(false);
                    }
                  }}
                >
                  Start Edit
                </Button>
              ) : null}
              {normalizeRole(editStage?.status) === "in_progress" && currentRole === "editor" ? (
                <Button
                  type="button"
                  disabled={mutating}
                  onClick={async () => {
                    try {
                      setMutating(true);
                      let videoUrl = String(editorVideoUrl || "").trim();
                      if (editorVideoFile) {
                        const upload = await api.uploadVideo(editorVideoFile);
                        videoUrl = upload?.data?.videoUrl || upload?.videoUrl || videoUrl;
                      }
                      await api.updateMyTaskStatus(data._id, editStage._id, {
                        status: "completed",
                        videoUrl,
                      });
                      toast.success("Edit submitted");
                      await loadData();
                    } catch (e) {
                      toast.error(e?.message || "Failed to submit edit");
                    } finally {
                      setMutating(false);
                    }
                  }}
                >
                  Submit Edit
                </Button>
              ) : null}
            </section>
          )}

          {(designStage?._id || designerVideoUrl) && (
            <section className="space-y-2">
              <h2 className="font-semibold">Graphic Designer</h2>
              <Input
                placeholder="Design video URL"
                value={designerVideoUrl}
                onChange={(e) => setDesignerVideoUrl(e.target.value)}
                disabled={currentRole !== "graphicdesigner"}
              />
              {currentRole === "graphicdesigner" ? (
                <Input
                  type="file"
                  accept="video/*"
                  onChange={(e) => setDesignerVideoFile(e.target.files?.[0] || null)}
                />
              ) : null}
              {designerVideoUrl ? (
                <video
                  src={resolveMediaUrl(designerVideoUrl)}
                  controls
                  className="w-full rounded-md border bg-black/10"
                />
              ) : null}
              {(normalizeRole(designStage?.status) === "assigned" ||
                normalizeRole(designStage?.status) === "planned") &&
              currentRole === "graphicdesigner" ? (
                <Button
                  type="button"
                  disabled={mutating}
                  onClick={async () => {
                    try {
                      setMutating(true);
                      await api.updateMyTaskStatus(data._id, designStage._id, { status: "in_progress" });
                      toast.success("Design started");
                      await loadData();
                    } catch (e) {
                      toast.error(e?.message || "Failed to start design");
                    } finally {
                      setMutating(false);
                    }
                  }}
                >
                  Start Design
                </Button>
              ) : null}
              {normalizeRole(designStage?.status) === "in_progress" &&
              currentRole === "graphicdesigner" ? (
                <Button
                  type="button"
                  disabled={mutating}
                  onClick={async () => {
                    try {
                      setMutating(true);
                      let videoUrl = String(designerVideoUrl || "").trim();
                      if (designerVideoFile) {
                        const upload = await api.uploadVideo(designerVideoFile);
                        videoUrl = upload?.data?.videoUrl || upload?.videoUrl || videoUrl;
                      }
                      await api.updateMyTaskStatus(data._id, designStage._id, {
                        status: "completed",
                        videoUrl,
                        designFileLink: videoUrl,
                      });
                      toast.success("Design submitted");
                      await loadData();
                    } catch (e) {
                      toast.error(e?.message || "Failed to submit design");
                    } finally {
                      setMutating(false);
                    }
                  }}
                >
                  Submit Design
                </Button>
              ) : null}
            </section>
          )}

          {approvalStage?._id && (
            <section className="space-y-2">
              <h2 className="font-semibold">Manager Approval</h2>
              {currentRole === "manager" ? (
                <>
                  <Input
                    placeholder="Rejection note (optional)"
                    value={managerRejectNote}
                    onChange={(e) => setManagerRejectNote(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={mutating}
                      onClick={async () => {
                        try {
                          setMutating(true);
                          await api.updateStageStatus(data._id, approvalStage._id, {
                            status: "approved",
                          });
                          toast.success("Approved");
                          await loadData();
                        } catch (e) {
                          toast.error(e?.message || "Failed to approve");
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
                          await api.updateStageStatus(data._id, approvalStage._id, {
                            status: "rejected",
                            rejectionNote: managerRejectNote,
                          });
                          toast.success("Rejected");
                          await loadData();
                        } catch (e) {
                          toast.error(e?.message || "Failed to reject");
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
            </section>
          )}

          {postStage?._id && currentRole === "postingexecutive" && (
            <section className="space-y-2">
              <h2 className="font-semibold">Posting</h2>
              {(normalizeRole(postStage?.status) === "assigned" ||
                normalizeRole(postStage?.status) === "planned") && (
                <Button
                  type="button"
                  disabled={mutating}
                  onClick={async () => {
                    try {
                      setMutating(true);
                      if (normalizeRole(postStage?.status) !== "in_progress") {
                        await api.updateMyTaskStatus(data._id, postStage._id, { status: "in_progress" });
                      }
                      await api.updateMyTaskStatus(data._id, postStage._id, { status: "completed" });
                      toast.success("Marked as posted");
                      await loadData();
                    } catch (e) {
                      toast.error(e?.message || "Failed to mark posted");
                    } finally {
                      setMutating(false);
                    }
                  }}
                >
                  Mark as Posted
                </Button>
              )}
            </section>
          )}

          <section className="space-y-2">
            <h2 className="font-semibold">Timeline</h2>
            {stages.map((stage) => (
              <div key={stage._id} className="rounded border p-3">
                <p className="font-medium">
                  {stage.stageName} ({stage.role})
                </p>
                <p className="text-sm text-muted-foreground">Status: {stage.status}</p>
                {stage?.assignedUser?.name ? (
                  <p className="text-sm text-muted-foreground">Assigned: {stage.assignedUser.name}</p>
                ) : null}
                {isCompletedLike(stage?.status) ? (
                  <Badge className="mt-2 bg-green-600 text-white">Completed</Badge>
                ) : null}
              </div>
            ))}
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
