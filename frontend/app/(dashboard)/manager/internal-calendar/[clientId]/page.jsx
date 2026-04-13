"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CalendarDays, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/shared/EmptyState";
import ContentCalendarDnd from "@/components/calendar/ContentCalendarDnd";

const DEFAULT_ROLE_CAPACITY = 5;

function prettyDate(ymd) {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

function toYmdUtc(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function postingInCustomRange(postingDate, start, end) {
  const p = toYmdUtc(postingDate);
  const s = toYmdUtc(start);
  const e = toYmdUtc(end);
  if (!p || !s || !e) return true;
  return p >= s && p <= e;
}

/** requestJson returns full `{ success, data }` — normalize to schedule bundle */
function normalizeScheduleApiPayload(res) {
  if (!res || typeof res !== "object") return null;
  const inner = res.data !== undefined ? res.data : res;
  if (inner && Array.isArray(inner.schedules)) return inner;
  if (inner?.data && Array.isArray(inner.data.schedules)) return inner.data;
  return null;
}

export default function ManagerInternalCalendarPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params?.clientId;

  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(null);
  const [roleCapMap, setRoleCapMap] = useState({});
  const [weekendMode, setWeekendMode] = useState(false);
  const [debugMeta, setDebugMeta] = useState(null);
  const customCalendarEnabled = Boolean(draft?.isCustomCalendar);
  const [scheduleBundle, setScheduleBundle] = useState(null);
  const [selectedMonthIndex, setSelectedMonthIndex] = useState(0);
  const [creatingMonth, setCreatingMonth] = useState(false);
  const [isDraftMode, setIsDraftMode] = useState(false);
  const [draftSchedules, setDraftSchedules] = useState([]);

  const load = useCallback(async () => {
    if (!clientId) return;
    try {
      setLoading(true);
      const calRes = await api.getInternalCalendar(clientId);
      const next = calRes?.data || calRes || null;
      setDraft(next);
      if (typeof next?.weekendEnabled === "boolean") {
        setWeekendMode(Boolean(next.weekendEnabled));
      }

      let schedData = null;
      try {
        const schedRes = await api.getClientSchedules(clientId);
        schedData = normalizeScheduleApiPayload(schedRes);
      } catch (schedErr) {
        console.error(schedErr);
        toast.error(schedErr?.message || "Failed to load custom month schedules");
      }
      if (schedData && Array.isArray(schedData.schedules)) {
        setScheduleBundle(schedData);
        setSelectedMonthIndex(schedData.schedules[0]?.monthIndex ?? 0);
        setIsDraftMode(false);
        setDraftSchedules([]);
      } else {
        setScheduleBundle(null);
        setIsDraftMode(false);
        setDraftSchedules([]);
      }
    } catch (err) {
      toast.error(err.message || "Failed to load internal calendar");
      setDraft(null);
      setScheduleBundle(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    setSelectedMonthIndex(0);
  }, [clientId]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const res = await api.getTeamCapacity();
        const list = Array.isArray(res?.data) ? res.data : [];
        const map = {};
        for (const row of list) {
          if (!row?.role) continue;
          const cap = Number(row.dailyCapacity);
          map[row.role] = Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_ROLE_CAPACITY;
        }
        if (mounted) setRoleCapMap(map);
      } catch {
        // Manager may not have access to role capacity endpoint; fallback is used.
        if (mounted) setRoleCapMap({});
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const selectedSchedule = useMemo(() => {
    const list = scheduleBundle?.schedules || [];
    if (!list.length) return null;
    return list.find((s) => s.monthIndex === selectedMonthIndex) || list[0];
  }, [scheduleBundle, selectedMonthIndex]);
  const selectedScheduleIsDraft = Boolean(selectedSchedule?.isDraft);

  const displayDraft = useMemo(() => {
    if (!draft || !selectedSchedule) return draft;
    let items = (draft.items || []).filter((it) =>
      postingInCustomRange(it.postingDate, selectedSchedule.startDate, selectedSchedule.endDate)
    );
    if (items.length === 0 && Array.isArray(selectedSchedule.items) && selectedSchedule.items.length > 0) {
      const inferType = (title) => {
        const t = String(title || "").toLowerCase();
        if (t.includes("reel")) return "reel";
        if (t.includes("carousel")) return "carousel";
        return "post";
      };
      items = selectedSchedule.items.map((row, idx) => ({
        contentId: String(row?.contentItem || `preview-${selectedSchedule.monthIndex}-${idx + 1}`),
        title: row?.title || `Item ${idx + 1}`,
        type: row?.type || inferType(row?.title),
        postingDate: toYmdUtc(row?.postingDate),
        stages:
          Array.isArray(row?.stages) && row.stages.length
            ? row.stages.map((s) => ({
                name: s?.name || s?.stageName || "",
                role: s?.role || "",
                assignedUser: s?.assignedUser || null,
                date: toYmdUtc(s?.date || s?.dueDate || row?.postingDate),
                status: s?.status || "assigned",
              }))
            : [
                {
                  name: "Post",
                  role: "postingExecutive",
                  date: toYmdUtc(row?.postingDate),
                  status: "assigned",
                },
              ],
      }));
    }
    return { ...draft, items };
  }, [draft, selectedSchedule]);

  const handleCreateNextMonth = async () => {
    if (!clientId) return;
    try {
      setCreatingMonth(true);
      const currentMaxMonthIndex = Math.max(
        -1,
        ...((scheduleBundle?.schedules || []).map((s) => Number(s?.monthIndex)).filter(Number.isFinite))
      );
      const res = await api.extendClientSchedules(clientId, 1, {
        startMonthIndex: currentMaxMonthIndex + 1,
      });
      const generated = Array.isArray(res?.data?.schedules) ? res.data.schedules : [];
      if (!generated.length) {
        toast.error("No month generated");
        return;
      }
      const deduped = generated.filter(
        (g) =>
          !(scheduleBundle?.schedules || []).some(
            (s) => Number(s?.monthIndex) === Number(g?.monthIndex)
          )
      );
      if (!deduped.length) {
        toast.error("This month draft already exists. Save or switch month.");
        return;
      }
      setScheduleBundle((prev) => ({
        ...(prev || {}),
        schedules: [...(prev?.schedules || []), ...deduped].sort(
          (a, b) => Number(a?.monthIndex) - Number(b?.monthIndex)
        ),
        totalMonths: Number(prev?.totalMonths || 0) + deduped.length,
        canCreateNextMonth: true,
      }));
      setDraftSchedules((prev) => [...prev, ...deduped]);
      setIsDraftMode(true);
      setSelectedMonthIndex(deduped[deduped.length - 1]?.monthIndex ?? selectedMonthIndex);
      toast.success("Next month generated in draft mode. Click Save Schedule to persist.");
    } catch (err) {
      toast.error(err?.message || "Failed to create month");
    } finally {
      setCreatingMonth(false);
    }
  };

  const handleSaveDraftSchedules = async () => {
    if (!clientId || !draftSchedules.length) return;
    try {
      setCreatingMonth(true);
      await api.saveClientSchedules(clientId, draftSchedules);
      toast.success("Schedule saved");
      await load();
    } catch (err) {
      toast.error(err?.message || "Failed to save schedule");
    } finally {
      setCreatingMonth(false);
    }
  };

  const moveStage = async ({ contentId, stageName, newDateYmd, allowWeekend }) => {
    const item = (draft?.items || []).find((it) => String(it.contentId) === String(contentId));
    const stage = (item?.stages || []).find((s) => String(s.name) === String(stageName));
    const stageId = stage?.stageId ? String(stage.stageId) : "";
    if (!stageId) throw new Error("Stage not found");
    await api.moveContentStage(contentId, stageId, {
      dueDate: newDateYmd,
      allowWeekend,
      fromGlobalCalendar: false,
    });
    setDebugMeta(null);
    await load();
  };

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Internal calendar</h2>
          <p className="text-sm text-muted-foreground">
            Stage moves use `/api/content/:itemId/stage/:stageId/move`.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarDays className="h-5 w-5" />
            Planning board
          </CardTitle>
          <CardDescription>
            Custom months follow your client start date (e.g. 9 Apr → 8 May), not calendar months. Each month is independent — edits do not propagate to other months. Drag stages when custom calendar is enabled.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {scheduleBundle?.schedules?.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Custom month:</span>
              {scheduleBundle.schedules.map((s) => (
                <Button
                  key={s.monthIndex}
                  type="button"
                  size="sm"
                  variant={selectedMonthIndex === s.monthIndex ? "default" : "outline"}
                  onClick={() => setSelectedMonthIndex(s.monthIndex)}
                >
                  M{s.monthIndex + 1}{" "}
                  <span className="hidden sm:inline">
                    ({prettyDate(toYmdUtc(s.startDate))} – {prettyDate(toYmdUtc(s.endDate))})
                  </span>
                </Button>
              ))}
              {scheduleBundle.canCreateNextMonth ? (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={creatingMonth}
                    onClick={() => void handleCreateNextMonth()}
                  >
                    {creatingMonth ? "Creating…" : "Create next month"}
                  </Button>
                  {isDraftMode ? (
                    <Button
                      type="button"
                      size="sm"
                      disabled={creatingMonth || draftSchedules.length === 0}
                      onClick={() => void handleSaveDraftSchedules()}
                    >
                      {creatingMonth ? "Saving…" : "Save Schedule"}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : !draft || (draft.items || []).length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No draft items"
              description="No internal calendar schedule found for this client yet."
            />
          ) : scheduleBundle?.schedules?.length && displayDraft && displayDraft.items.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No items in this custom month"
              description="Switch to another month or create the next month when available."
            />
          ) : (
            <ContentCalendarDnd
              key={`${clientId}-${selectedMonthIndex}`}
              clientId={clientId}
              draft={displayDraft}
              onStageMove={selectedScheduleIsDraft ? undefined : moveStage}
              editableStageNames={
                selectedScheduleIsDraft
                  ? ["Plan", "Shoot", "Edit", "Design", "Approval", "Post"]
                  : undefined
              }
              roleCapMap={roleCapMap}
              saving={loading}
              canEdit={selectedScheduleIsDraft ? true : customCalendarEnabled}
              isCustomizationMode={selectedScheduleIsDraft}
              allowPostCreationEdit
              lockPostStage={!selectedScheduleIsDraft}
              weekendMode={weekendMode}
              weekendBlockedConfirmEnabled={selectedScheduleIsDraft ? true : customCalendarEnabled}
              onToggleWeekend={setWeekendMode}
              onCalendarStateChange={(nextDraft) => {
                if (!selectedScheduleIsDraft) return;
                const nextItems = (nextDraft?.items || []).map((it) => ({
                  contentItem: it.contentId,
                  title: it.title,
                  type: it.type,
                  postingDate: it.postingDate,
                  stages: (it.stages || []).map((s) => ({
                    name: s.name,
                    role: s.role,
                    assignedUser: s.assignedUser || null,
                    date: s.date,
                    status: s.status || "assigned",
                  })),
                }));
                setScheduleBundle((prev) => {
                  if (!prev?.schedules?.length) return prev;
                  return {
                    ...prev,
                    schedules: prev.schedules.map((s) =>
                      Number(s.monthIndex) === Number(selectedMonthIndex) ? { ...s, items: nextItems } : s
                    ),
                  };
                });
                setDraftSchedules((prev) =>
                  prev.map((s) =>
                    Number(s.monthIndex) === Number(selectedMonthIndex) ? { ...s, items: nextItems } : s
                  )
                );
              }}
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scheduler Debug Panel</CardTitle>
          <CardDescription>Last drag decision details from backend scheduler.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!debugMeta ? (
            <p className="text-muted-foreground">No drag action yet.</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Original duration</span>
                <span>{debugMeta.originalDurationDays || 1} day(s)</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Final duration</span>
                <span>{debugMeta.finalDurationDays || 1} day(s)</span>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Badge variant={debugMeta.durationAdjusted ? "default" : "outline"}>
                  extended: {debugMeta.durationAdjusted ? "yes" : "no"}
                </Badge>
                <Badge variant={debugMeta.borrowed ? "default" : "outline"}>
                  borrowed: {debugMeta.borrowed ? "yes" : "no"}
                </Badge>
                <Badge variant={debugMeta.replacementApplied ? "default" : "outline"}>
                  replaced: {debugMeta.replacementApplied ? "yes" : "no"}
                </Badge>
              </div>
              <div className="pt-1">
                <p className="text-xs text-muted-foreground">Reason</p>
                <p>{debugMeta.reason || "-"}</p>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Posting commitments</CardTitle>
          <CardDescription>Read-only posting dates per content item.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(draft?.items || []).map((item) => (
            <div key={String(item.contentId)} className="flex items-center justify-between rounded border p-2">
              <span className="font-medium capitalize">{item.type}</span>
              <span className="text-muted-foreground">{prettyDate(item.postingDate)}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

