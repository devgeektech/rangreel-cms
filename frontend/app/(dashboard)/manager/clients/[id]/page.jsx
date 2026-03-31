"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Film,
  Layers,
  Square,
  Star,
  User,
  Users2,
  Pencil,
} from "lucide-react";
import { toast } from "sonner";
import { api, apiFetch } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ReelDetailDialog } from "@/components/reel/ReelDetailDialog";

const pad2 = (n) => String(n).padStart(2, "0");

function toMonthStringUTC(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
}

function shiftMonth(monthStr, delta) {
  const m = String(monthStr).match(/^(\d{4})-(\d{2})$/);
  if (!m) return monthStr;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const d = new Date(Date.UTC(year, monthIndex, 1));
  d.setUTCMonth(d.getUTCMonth() + delta);
  return toMonthStringUTC(d);
}

function formatMonthLabel(monthStr) {
  const m = String(monthStr).match(/^(\d{4})-(\d{2})$/);
  if (!m) return monthStr;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

function toYMDUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function roleIcon(role) {
  const r = String(role || "").toLowerCase();
  if (r.includes("strategist")) return ClipboardList;
  if (r.includes("videographer")) return Film;
  if (r.includes("videoeditor") || r.includes("editor")) return Pencil;
  if (r.includes("graphic")) return Layers;
  if (r.includes("posting")) return Square;
  if (r.includes("manager")) return User;
  return Users2;
}

const BRIEF_TONE = {
  luxury: "Luxury",
  premium: "Premium",
  bold: "Bold",
  friendly: "Friendly",
  minimal: "Minimal",
  other: "Other",
};
const BRIEF_LANG = { english: "English", hindi: "Hindi", other: "Other" };
const BRIEF_GOAL = { awareness: "Awareness", sales: "Sales", social_growth: "Social growth" };
const CONTENT_PREF = {
  education: "Educational",
  promotional: "Promotional",
  entertaining: "Entertaining",
  trend_based: "Trend-based",
};

function hasMeaningfulClientBrief(b) {
  if (!b || typeof b !== "object") return false;
  const t = (x) => (typeof x === "string" ? x.trim() : "");
  if (t(b.usp)) return true;
  if (t(b.brandTone) || t(b.brandToneOther)) return true;
  if (t(b.targetAudience)) return true;
  if (t(b.keyProductsServices)) return true;
  if (t(b.priorityFocus)) return true;
  if (t(b.festivalsToTarget)) return true;
  if (b.language && b.language !== "english") return true;
  if (t(b.languageOther)) return true;
  if (t(b.competitors)) return true;
  if (t(b.accountsYouLikeReason)) return true;
  if (t(b.mainGoal)) return true;
  if (t(b.ageGroup)) return true;
  if (t(b.focusLocations)) return true;
  if (Array.isArray(b.contentPreference) && b.contentPreference.length > 0) return true;
  const sa = b.shootAvailability;
  if (sa && (sa.storeOrOfficeForShoot || sa.productsReadyForShoot || sa.modelsAvailable)) return true;
  if (t(b.preferredShootDaysTiming) || t(b.bestPostingTime)) return true;
  if (t(b.driveBrandKitUrl) || t(b.driveSocialCredentialsUrl) || t(b.driveOtherFilesUrl)) return true;
  return false;
}

function formatFileSize(bytes) {
  if (bytes == null || Number.isNaN(Number(bytes))) return "";
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function downloadClientBriefFile(clientId, fileId, filename) {
  const res = await apiFetch(
    `/manager/clients/${encodeURIComponent(clientId)}/brief-assets/${encodeURIComponent(fileId)}/download`,
    { method: "GET" }
  );
  if (!res.ok) {
    let msg = "Download failed";
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function statusBadge(status) {
  const s = String(status || "").toLowerCase();
  if (s === "approved") return <Badge>Approved</Badge>;
  if (s === "rejected") return <Badge variant="destructive">Rejected</Badge>;
  if (s === "completed" || s === "posted") return <Badge className="bg-green-600 text-white">Completed</Badge>;
  if (s === "in_progress") return <Badge variant="outline">In progress</Badge>;
  if (s === "assigned") return <Badge variant="outline">Assigned</Badge>;
  return <Badge variant="outline">{status}</Badge>;
}

export default function ManagerClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id;

  const [loading, setLoading] = useState(true);
  const [client, setClient] = useState(null);
  const [month, setMonth] = useState(() => toMonthStringUTC(new Date()));
  const [tab, setTab] = useState("client");
  const [clientCalendarLoading, setClientCalendarLoading] = useState(true);
  const [teamCalendarLoading, setTeamCalendarLoading] = useState(true);
  const [clientCalendar, setClientCalendar] = useState([]);
  const [teamCalendar, setTeamCalendar] = useState([]);

  const [openGoogleReviews, setOpenGoogleReviews] = useState(false);
  const [googleAchievedDraft, setGoogleAchievedDraft] = useState("");
  const [googleReviewsSaving, setGoogleReviewsSaving] = useState(false);
  const [openReelDetail, setOpenReelDetail] = useState(false);
  const [selectedContentId, setSelectedContentId] = useState(null);
  const [moreBriefFiles, setMoreBriefFiles] = useState({
    brandKit: [],
    socialCredentials: [],
    other: [],
  });
  const [briefUploading, setBriefUploading] = useState(false);

  const loadClient = async () => {
    try {
      setLoading(true);
      const res = await api.getClient(id);
      setClient(res?.data || null);
    } catch (error) {
      toast.error(error.message || "Failed to load client");
    } finally {
      setLoading(false);
    }
  };

  const submitMoreBriefFiles = async () => {
    if (!id) return;
    const n =
      moreBriefFiles.brandKit.length +
      moreBriefFiles.socialCredentials.length +
      moreBriefFiles.other.length;
    if (n === 0) {
      toast.error("Choose at least one file to upload");
      return;
    }
    try {
      setBriefUploading(true);
      const formData = new FormData();
      moreBriefFiles.brandKit.forEach((f) => formData.append("brandKit", f));
      moreBriefFiles.socialCredentials.forEach((f) => formData.append("socialCredentials", f));
      moreBriefFiles.other.forEach((f) => formData.append("other", f));
      await api.uploadClientBriefAssets(id, formData);
      toast.success("Files uploaded");
      setMoreBriefFiles({ brandKit: [], socialCredentials: [], other: [] });
      await loadClient();
    } catch (error) {
      toast.error(error.message || "Upload failed");
    } finally {
      setBriefUploading(false);
    }
  };

  const loadClientCalendar = async () => {
    try {
      setClientCalendarLoading(true);
      const res = await api.getClientCalendar(id, month);
      setClientCalendar(res?.data || []);
    } catch (error) {
      toast.error(error.message || "Failed to load client calendar");
    } finally {
      setClientCalendarLoading(false);
    }
  };

  const loadTeamCalendar = async () => {
    try {
      setTeamCalendarLoading(true);
      const res = await api.getTeamCalendar(id, month);
      setTeamCalendar(res?.data || []);
    } catch (error) {
      toast.error(error.message || "Failed to load team calendar");
    } finally {
      setTeamCalendarLoading(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    loadClient();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!id) return;
    loadClientCalendar();
    loadTeamCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, month]);

  const clientPostingMap = useMemo(() => {
    const map = new Map();
    (clientCalendar || []).forEach((item) => {
      const key = toYMDUTC(new Date(item.postingDate));
      map.set(key, [...(map.get(key) || []), item]);
    });
    return map;
  }, [clientCalendar]);

  const stageByDayMap = useMemo(() => {
    // Map dayKey -> stages[] (flattened)
    const map = new Map();
    (teamCalendar || []).forEach((item) => {
      (item.stages || []).forEach((stage) => {
        const due = stage.dueDate ? new Date(stage.dueDate) : null;
        if (!due || Number.isNaN(due.getTime())) return;
        const dayKey = toYMDUTC(due);
        const entry = {
          contentItemId: item.contentItemId,
          itemTitle: item.title,
          planType: item.planType || item.plan || "normal",
          stageName: stage.stageName,
          role: stage.role,
          status: stage.status,
          assignedUser: stage.assignedUser,
          dueDate: stage.dueDate,
        };
        map.set(dayKey, [...(map.get(dayKey) || []), entry]);
      });
    });

    // Sort within each day by due date then stageIndex
    for (const [k, arr] of map.entries()) {
      map.set(
        k,
        arr.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
      );
    }

    return map;
  }, [teamCalendar]);

  const calendarCells = useMemo(() => {
    const m = String(month).match(/^(\d{4})-(\d{2})$/);
    if (!m) return [];
    const year = Number(m[1]);
    const monthIndex = Number(m[2]) - 1;
    const start = new Date(Date.UTC(year, monthIndex, 1));
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const startDay = start.getUTCDay();
    const totalCells = Math.ceil((startDay + daysInMonth) / 7) * 7;
    const cells = [];
    for (let i = 0; i < totalCells; i++) {
      if (i < startDay) cells.push(null);
      else {
        const dayNum = i - startDay + 1;
        if (dayNum > daysInMonth) cells.push(null);
        else {
          const d = new Date(Date.UTC(year, monthIndex, dayNum));
          cells.push({ dayNum, ymd: toYMDUTC(d) });
        }
      }
    }
    return cells;
  }, [month]);

  const openGoogleReviewsDialog = () => {
    const achieved = client?.googleReviewsAchieved ?? 0;
    setGoogleAchievedDraft(String(achieved));
    setOpenGoogleReviews(true);
  };

  const submitGoogleAchieved = async () => {
    const n = Number.parseInt(googleAchievedDraft, 10);
    if (Number.isNaN(n) || n < 0) {
      toast.error("Enter a valid non-negative number");
      return;
    }
    try {
      setGoogleReviewsSaving(true);
      await api.updateClientGoogleReviews(id, { googleReviewsAchieved: n });
      toast.success("Google reviews count updated");
      setOpenGoogleReviews(false);
      await loadClient();
    } catch (error) {
      toast.error(error.message || "Failed to update");
    } finally {
      setGoogleReviewsSaving(false);
    }
  };

  const team = client?.team || {};
  const activePlan = client?.activeContentCounts;
  const pkg = client?.package || {};
  const scheduledReels =
    activePlan != null && activePlan.noOfReels != null
      ? Number(activePlan.noOfReels) > 0
      : (Number(pkg.noOfReels) || 0) > 0 || Boolean(team.reels && Object.values(team.reels).some(Boolean));
  const scheduledStatic =
    activePlan != null && activePlan.noOfStaticPosts != null
      ? Number(activePlan.noOfStaticPosts) > 0
      : ((Number(pkg.noOfPosts) || 0) + (Number(pkg.noOfStaticPosts) || 0)) > 0 ||
        Boolean(team.posts && Object.values(team.posts).some(Boolean));
  const scheduledCarousel =
    activePlan != null && activePlan.noOfCarousels != null
      ? Number(activePlan.noOfCarousels) > 0
      : (Number(pkg.noOfCarousels) || 0) > 0 ||
        Boolean(team.carousel && Object.values(team.carousel).some(Boolean));

  const reviewsTarget = Number(client?.googleReviewsTarget ?? client?.package?.noOfGoogleReviews ?? 0);
  const reviewsAchieved = Number(client?.googleReviewsAchieved ?? 0);
  const reviewsPct =
    reviewsTarget > 0 ? Math.min(100, Math.round((reviewsAchieved / reviewsTarget) * 100)) : reviewsAchieved > 0 ? 100 : 0;

  return (
    <section className="space-y-5">
      {loading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : client ? (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2 xl:col-span-2">
              <CardHeader>
                <CardTitle>Client info</CardTitle>
                <CardDescription>Onboarding details, positioning, and production preferences.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="grid gap-2 sm:grid-cols-2">
                  <Row label="Name" value={client.clientName} />
                  <Row label="Brand name" value={client.brandName} />
                  <Row label="Contact number" value={client.contactNumber || "-"} />
                  <Row label="Email" value={client.email || "-"} />
                  <Row label="Website" value={client.website || "-"} />
                  <Row label="Industry" value={client.industry || "-"} />
                  <Row label="Business type" value={client.businessType || "-"} />
                  <Row label="Start" value={client.startDate ? new Date(client.startDate).toLocaleDateString() : "-"} />
                  <Row label="End" value={client.endDate ? new Date(client.endDate).toLocaleDateString() : "-"} />
                </div>

                {(client.socialCredentialsNotes || "").trim() ? (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Social credentials (notes)</p>
                    <p className="mt-1 whitespace-pre-wrap text-foreground">{client.socialCredentialsNotes}</p>
                  </div>
                ) : null}

                <div>
                  <p className="text-xs font-medium text-muted-foreground">Social handles</p>
                  <div className="mt-1 grid gap-1 text-muted-foreground sm:grid-cols-2">
                    <span>Instagram: {client.socialHandles?.instagram || "-"}</span>
                    <span>Facebook: {client.socialHandles?.facebook || "-"}</span>
                    <span>YouTube: {client.socialHandles?.youtube || "-"}</span>
                    <span>Google Business: {client.socialHandles?.googleBusiness || "-"}</span>
                    <span>X / Twitter: {client.socialHandles?.twitter || "-"}</span>
                    <span>LinkedIn: {client.socialHandles?.linkedin || "-"}</span>
                    <span>TikTok: {client.socialHandles?.tiktok || "-"}</span>
                    <span>Pinterest: {client.socialHandles?.pinterest || "-"}</span>
                    <span className="sm:col-span-2">Other: {client.socialHandles?.other || "-"}</span>
                  </div>
                </div>

                <div className="space-y-3 border-t border-border pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Onboarding files</p>
                  {[
                    { title: "Brand kit / identity", files: client.clientBrief?.brandKitFiles },
                    { title: "Social credentials", files: client.clientBrief?.socialCredentialsFiles },
                    { title: "Other essential files", files: client.clientBrief?.otherBriefFiles },
                  ].map(({ title, files }) =>
                    Array.isArray(files) && files.length > 0 ? (
                      <div key={title}>
                        <p className="text-xs font-medium text-muted-foreground">{title}</p>
                        <ul className="mt-1 space-y-1">
                          {files.map((f) => (
                            <li
                              key={f._id}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/20 px-2 py-1.5 text-xs"
                            >
                              <span className="min-w-0 break-all text-foreground">
                                {f.originalName || f.storedName}
                                {f.size ? (
                                  <span className="ml-1 text-muted-foreground">({formatFileSize(f.size)})</span>
                                ) : null}
                              </span>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="shrink-0"
                                onClick={() =>
                                  downloadClientBriefFile(id, f._id, f.originalName || f.storedName).catch((e) =>
                                    toast.error(e.message || "Download failed")
                                  )
                                }
                              >
                                Download
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null
                  )}
                  {!client.clientBrief?.brandKitFiles?.length &&
                  !client.clientBrief?.socialCredentialsFiles?.length &&
                  !client.clientBrief?.otherBriefFiles?.length ? (
                    <p className="text-xs text-muted-foreground">No files uploaded yet.</p>
                  ) : null}

                  <div className="rounded-lg border border-dashed border-border bg-muted/10 p-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Add more files</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Brand kit</Label>
                        <Input
                          type="file"
                          multiple
                          className="cursor-pointer text-xs file:mr-2"
                          onChange={(e) => {
                            const list = e.target.files;
                            if (list?.length)
                              setMoreBriefFiles((p) => ({
                                ...p,
                                brandKit: [...p.brandKit, ...Array.from(list)],
                              }));
                            e.target.value = "";
                          }}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Social credentials</Label>
                        <Input
                          type="file"
                          multiple
                          className="cursor-pointer text-xs file:mr-2"
                          onChange={(e) => {
                            const list = e.target.files;
                            if (list?.length)
                              setMoreBriefFiles((p) => ({
                                ...p,
                                socialCredentials: [...p.socialCredentials, ...Array.from(list)],
                              }));
                            e.target.value = "";
                          }}
                        />
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <Label className="text-xs">Other</Label>
                        <Input
                          type="file"
                          multiple
                          className="cursor-pointer text-xs file:mr-2"
                          onChange={(e) => {
                            const list = e.target.files;
                            if (list?.length)
                              setMoreBriefFiles((p) => ({ ...p, other: [...p.other, ...Array.from(list)] }));
                            e.target.value = "";
                          }}
                        />
                      </div>
                    </div>
                    {(moreBriefFiles.brandKit.length > 0 ||
                      moreBriefFiles.socialCredentials.length > 0 ||
                      moreBriefFiles.other.length > 0) && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Queued:{" "}
                        {[
                          ...moreBriefFiles.brandKit,
                          ...moreBriefFiles.socialCredentials,
                          ...moreBriefFiles.other,
                        ]
                          .map((f) => f.name)
                          .join(", ")}
                      </p>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      className="mt-3"
                      disabled={briefUploading}
                      onClick={submitMoreBriefFiles}
                    >
                      {briefUploading ? "Uploading…" : "Upload queued files"}
                    </Button>
                  </div>
                </div>

                {hasMeaningfulClientBrief(client.clientBrief) ? (
                  <div className="space-y-3 border-t border-border pt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Brand brief</p>
                    {client.clientBrief.usp ? (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">USP</p>
                        <p className="mt-0.5 whitespace-pre-wrap">{client.clientBrief.usp}</p>
                      </div>
                    ) : null}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Row
                        label="Brand tone"
                        value={
                          client.clientBrief.brandTone
                            ? `${BRIEF_TONE[client.clientBrief.brandTone] || client.clientBrief.brandTone}${
                                client.clientBrief.brandTone === "other" && client.clientBrief.brandToneOther
                                  ? ` — ${client.clientBrief.brandToneOther}`
                                  : ""
                              }`
                            : "-"
                        }
                      />
                      <Row
                        label="Language"
                        value={
                          client.clientBrief.language
                            ? `${BRIEF_LANG[client.clientBrief.language] || client.clientBrief.language}${
                                client.clientBrief.language === "other" && client.clientBrief.languageOther
                                  ? ` — ${client.clientBrief.languageOther}`
                                  : ""
                              }`
                            : "-"
                        }
                      />
                      <Row
                        label="Main goal"
                        value={
                          client.clientBrief.mainGoal
                            ? BRIEF_GOAL[client.clientBrief.mainGoal] || client.clientBrief.mainGoal
                            : "-"
                        }
                      />
                      <Row label="Age group" value={client.clientBrief.ageGroup || "-"} />
                    </div>
                    {client.clientBrief.targetAudience ? (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Target audience</p>
                        <p className="mt-0.5 whitespace-pre-wrap">{client.clientBrief.targetAudience}</p>
                      </div>
                    ) : null}
                    {client.clientBrief.keyProductsServices ? (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Key products / services</p>
                        <p className="mt-0.5 whitespace-pre-wrap">{client.clientBrief.keyProductsServices}</p>
                      </div>
                    ) : null}
                    {client.clientBrief.priorityFocus ? (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Priority focus</p>
                        <p className="mt-0.5 whitespace-pre-wrap">{client.clientBrief.priorityFocus}</p>
                      </div>
                    ) : null}
                    {client.clientBrief.festivalsToTarget ? (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Festivals to target</p>
                        <p className="mt-0.5 whitespace-pre-wrap">{client.clientBrief.festivalsToTarget}</p>
                      </div>
                    ) : null}
                    {client.clientBrief.competitors ? (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Competitors</p>
                        <p className="mt-0.5 whitespace-pre-wrap">{client.clientBrief.competitors}</p>
                      </div>
                    ) : null}
                    {client.clientBrief.accountsYouLikeReason ? (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Accounts you like (with reason)</p>
                        <p className="mt-0.5 whitespace-pre-wrap">{client.clientBrief.accountsYouLikeReason}</p>
                      </div>
                    ) : null}
                    {client.clientBrief.focusLocations ? (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Focus locations</p>
                        <p className="mt-0.5 whitespace-pre-wrap">{client.clientBrief.focusLocations}</p>
                      </div>
                    ) : null}
                    {Array.isArray(client.clientBrief.contentPreference) &&
                    client.clientBrief.contentPreference.length > 0 ? (
                      <Row
                        label="Content preference"
                        value={client.clientBrief.contentPreference
                          .map((k) => CONTENT_PREF[k] || k)
                          .join(", ")}
                      />
                    ) : null}
                    {client.clientBrief.shootAvailability ? (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Shoot readiness</p>
                        <ul className="mt-1 list-inside list-disc text-muted-foreground">
                          {client.clientBrief.shootAvailability.storeOrOfficeForShoot ? (
                            <li>Store / office for shoot</li>
                          ) : null}
                          {client.clientBrief.shootAvailability.productsReadyForShoot ? (
                            <li>Products ready for shoot</li>
                          ) : null}
                          {client.clientBrief.shootAvailability.modelsAvailable ? <li>Models available</li> : null}
                          {!client.clientBrief.shootAvailability.storeOrOfficeForShoot &&
                          !client.clientBrief.shootAvailability.productsReadyForShoot &&
                          !client.clientBrief.shootAvailability.modelsAvailable ? (
                            <li className="list-none text-muted-foreground/80">None selected</li>
                          ) : null}
                        </ul>
                      </div>
                    ) : null}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Row
                        label="Preferred shoot days / timing"
                        value={client.clientBrief.preferredShootDaysTiming || "-"}
                      />
                      <Row label="Best posting time" value={client.clientBrief.bestPostingTime || "-"} />
                    </div>
                    {(client.clientBrief.driveBrandKitUrl ||
                      client.clientBrief.driveSocialCredentialsUrl ||
                      client.clientBrief.driveOtherFilesUrl) ? (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Legacy external links</p>
                        <div className="mt-1 grid gap-1 break-all text-xs">
                          {client.clientBrief.driveBrandKitUrl ? (
                            <span>
                              Brand kit:{" "}
                              <a
                                className="text-primary underline underline-offset-2"
                                href={client.clientBrief.driveBrandKitUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {client.clientBrief.driveBrandKitUrl}
                              </a>
                            </span>
                          ) : null}
                          {client.clientBrief.driveSocialCredentialsUrl ? (
                            <span>
                              Social credentials:{" "}
                              <a
                                className="text-primary underline underline-offset-2"
                                href={client.clientBrief.driveSocialCredentialsUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {client.clientBrief.driveSocialCredentialsUrl}
                              </a>
                            </span>
                          ) : null}
                          {client.clientBrief.driveOtherFilesUrl ? (
                            <span>
                              Other:{" "}
                              <a
                                className="text-primary underline underline-offset-2"
                                href={client.clientBrief.driveOtherFilesUrl}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {client.clientBrief.driveOtherFilesUrl}
                              </a>
                            </span>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Package Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <Row label="Package" value={client.package?.name || "-"} />
                <Row label="Reels" value={client.package?.noOfReels ?? 0} />
                <Row
                  label="Static (package)"
                  value={(Number(client.package?.noOfPosts) || 0) + (Number(client.package?.noOfStaticPosts) || 0)}
                />
                <Row label="Carousels" value={client.package?.noOfCarousels ?? 0} />
                <Row label="Google Reviews (package)" value={client.package?.noOfGoogleReviews ?? 0} />
                <Row label="GMB Posting" value={client.package?.gmbPosting ? "Included" : "Not Included"} />
                <Row
                  label="Campaign Management"
                  value={client.package?.campaignManagement ? "Included" : "Not Included"}
                />
                {client.activeContentCounts ? (
                  <div className="mt-3 border-t border-border pt-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Scheduled for this client</p>
                    <Row label="Reels" value={client.activeContentCounts.noOfReels ?? 0} />
                    <Row label="Static" value={client.activeContentCounts.noOfStaticPosts ?? 0} />
                    <Row label="Carousels" value={client.activeContentCounts.noOfCarousels ?? 0} />
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Star className="h-4 w-4 text-amber-500" />
                    Google Reviews Progress
                  </CardTitle>
                  <CardDescription>Target vs achieved for this client.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-baseline justify-between gap-2">
                  <div>
                    <p className="text-2xl font-semibold tabular-nums">
                      {reviewsAchieved}
                      <span className="text-base font-normal text-muted-foreground">
                        {" "}
                        / {reviewsTarget}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">Achieved · Target</p>
                  </div>
                  <Badge variant="outline">{reviewsPct}%</Badge>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-amber-500/90 transition-[width]"
                    style={{ width: `${reviewsPct}%` }}
                  />
                </div>
                <Button type="button" variant="outline" className="w-full" onClick={openGoogleReviewsDialog}>
                  Update achieved count
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Team</CardTitle>
              <CardDescription>
                Per workflow: reels, static, and carousel each have their own assignees (matches client creation).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              {scheduledReels ? (
                <TeamGroup title="Reels team" emoji="🎬">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <TeamCard label="Strategist" user={team.reels?.strategist} />
                    <TeamCard label="Videographer" user={team.reels?.videographer} />
                    <TeamCard label="Video Editor" user={team.reels?.videoEditor} />
                    <TeamCard label="Manager" user={team.reels?.manager} />
                    <TeamCard label="Posting Executive" user={team.reels?.postingExecutive} />
                  </div>
                </TeamGroup>
              ) : (
                <p className="text-sm text-muted-foreground">No reels team — static/carousel-only or not scheduled for this client.</p>
              )}

              {scheduledStatic ? (
                <TeamGroup title="Static team" emoji="🖼">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <TeamCard label="Strategist" user={team.posts?.strategist} />
                    <TeamCard label="Graphic Designer" user={team.posts?.graphicDesigner} />
                    <TeamCard label="Manager" user={team.posts?.manager} />
                    <TeamCard label="Posting Executive" user={team.posts?.postingExecutive} />
                  </div>
                </TeamGroup>
              ) : (
                <p className="text-sm text-muted-foreground">No static team for this client.</p>
              )}

              {scheduledCarousel ? (
                <TeamGroup title="Carousel team" emoji="📚">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    <TeamCard label="Strategist" user={team.carousel?.strategist} />
                    <TeamCard label="Graphic Designer" user={team.carousel?.graphicDesigner} />
                    <TeamCard label="Manager" user={team.carousel?.manager} />
                    <TeamCard label="Posting Executive" user={team.carousel?.postingExecutive} />
                  </div>
                </TeamGroup>
              ) : (
                <p className="text-sm text-muted-foreground">No carousel team for this client.</p>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setMonth((prev) => shiftMonth(prev, -1))}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="min-w-[160px] text-center">
                <p className="text-sm font-medium">{formatMonthLabel(month)}</p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => setMonth((prev) => shiftMonth(prev, 1))}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={tab === "client" ? "default" : "outline"}
                onClick={() => setTab("client")}
              >
                Client Calendar
              </Button>
              <Button
                type="button"
                variant={tab === "team" ? "default" : "outline"}
                onClick={() => setTab("team")}
              >
                Team Calendar
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(`/manager/internal-calendar/${id}`)}
              >
                Internal Calendar
              </Button>
            </div>
          </div>

          {tab === "client" ? (
            <Card>
              <CardHeader>
                <CardTitle>Client calendar</CardTitle>
                <CardDescription>
                  Posting dates only. Read-only — dates cannot be edited here. Red = Urgent, default = Normal.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {clientCalendarLoading ? (
                  <div className="grid grid-cols-7 gap-2">
                    {Array.from({ length: 28 }).map((_, idx) => (
                      <Skeleton key={idx} className="h-24 w-full" />
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-7 gap-0 rounded-xl border border-border overflow-hidden">
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                        <div key={d} className="bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
                          {d}
                        </div>
                      ))}
                      {calendarCells.map((cell, idx) => (
                        <div key={idx} className={`min-h-[110px] border-t border-border p-2 ${cell ? "" : "bg-muted/10"}`}>
                          {cell ? (
                            <>
                              <p className="text-xs font-medium text-muted-foreground">{cell.dayNum}</p>
                              <div className="mt-2 space-y-1">
                                {(clientPostingMap.get(cell.ymd) || []).map((item) => {
                                  const urgent =
                                    String(item.planType || "").toLowerCase() === "urgent";
                                  return (
                                    <div
                                      key={`${item.title}-${String(item.postingDate)}`}
                                      className={`inline-flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[11px] ${
                                        urgent
                                          ? "bg-red-500/15 text-red-700 border border-red-500/30 dark:text-red-200"
                                          : "bg-primary/15 text-primary"
                                      }`}
                                      title={item.title}
                                    >
                                      <Calendar className="h-3.5 w-3.5" />
                                      <span className="truncate font-medium">{item.title}</span>
                                      {urgent ? (
                                        <span className="ml-auto text-[10px] font-semibold">URGENT</span>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            </>
                          ) : (
                            <div className="h-[110px]" />
                          )}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Team calendar</CardTitle>
                <CardDescription>
                  Stage view with assignees and status. Red border = Urgent plan reel.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {teamCalendarLoading ? (
                  <div className="grid grid-cols-7 gap-2">
                    {Array.from({ length: 28 }).map((_, idx) => (
                      <Skeleton key={idx} className="h-24 w-full" />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-7 gap-0 rounded-xl border border-border overflow-hidden">
                    {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                      <div key={d} className="bg-muted/30 px-3 py-2 text-xs font-medium text-muted-foreground">
                        {d}
                      </div>
                    ))}
                    {calendarCells.map((cell, idx) => (
                      <div key={idx} className={`min-h-[130px] border-t border-border p-2 ${cell ? "" : "bg-muted/10"}`}>
                        {cell ? (
                          <>
                            <p className="text-xs font-medium text-muted-foreground">{cell.dayNum}</p>
                            <div className="mt-2 space-y-2">
                              {(stageByDayMap.get(cell.ymd) || []).map((entry) => {
                                const Icon = roleIcon(entry.role);
                                const urgent =
                                  String(entry.planType || "").toLowerCase() === "urgent";
                                return (
                                  <div
                                    key={`${entry.itemTitle}-${entry.stageName}-${entry.dueDate}`}
                                    className={`rounded-lg border bg-card px-2 py-2 cursor-pointer hover:bg-muted/30 ${
                                      urgent
                                        ? "border-red-500/50 bg-red-500/5"
                                        : "border-border"
                                    }`}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => {
                                      if (!entry.contentItemId) return;
                                      setSelectedContentId(entry.contentItemId);
                                      setOpenReelDetail(true);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        if (!entry.contentItemId) return;
                                        setSelectedContentId(entry.contentItemId);
                                        setOpenReelDetail(true);
                                      }
                                    }}
                                  >
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="min-w-0 text-left">
                                        <div className="flex items-center gap-1.5">
                                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                                          <span className="text-xs font-medium">{entry.role}</span>
                                        </div>
                                        <p className="mt-1 truncate text-xs text-muted-foreground">
                                          {entry.itemTitle}
                                        </p>
                                      </div>
                                      <div className="shrink-0">{statusBadge(entry.status)}</div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        ) : (
                          <div className="h-[130px]" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}


          <Dialog
            open={openGoogleReviews}
            onOpenChange={(open) => {
              setOpenGoogleReviews(open);
              if (!open) setGoogleAchievedDraft("");
            }}
          >
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Update achieved Google reviews</DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <p className="text-muted-foreground">
                  Target (from client / package): <strong>{reviewsTarget}</strong>
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor="google-achieved">Achieved count</Label>
                  <Input
                    id="google-achieved"
                    type="number"
                    min={0}
                    step={1}
                    value={googleAchievedDraft}
                    onChange={(e) => setGoogleAchievedDraft(e.target.value)}
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button type="button" variant="outline" onClick={() => setOpenGoogleReviews(false)} disabled={googleReviewsSaving}>
                    Cancel
                  </Button>
                  <Button type="button" onClick={submitGoogleAchieved} disabled={googleReviewsSaving}>
                    {googleReviewsSaving ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <ReelDetailDialog
            open={openReelDetail}
            onOpenChange={(v) => {
              setOpenReelDetail(v);
              if (!v) setSelectedContentId(null);
            }}
            contentId={selectedContentId}
            viewerRole="manager"
            onDidMutate={async () => {
              await loadTeamCalendar();
            }}
          />
        </>
      ) : (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted-foreground">Client not found.</p>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

function TeamGroup({ title, emoji, children }) {
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold">
        <span className="mr-1.5" aria-hidden>
          {emoji}
        </span>
        {title}
      </h4>
      {children}
    </div>
  );
}

function TeamCard({ label, user }) {
  const name = user?.name || "Unassigned";
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-2 flex items-center gap-2">
        <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
          {(name || "U")
            .split(" ")
            .map((p) => p[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{name}</p>
          {user?.email ? <p className="truncate text-xs text-muted-foreground">{user.email}</p> : null}
        </div>
      </div>
    </div>
  );
}


