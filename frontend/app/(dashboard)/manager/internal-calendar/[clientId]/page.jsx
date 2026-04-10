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
  const [weekendMode, setWeekendMode] = useState(true);
  const [debugMeta, setDebugMeta] = useState(null);
  const customCalendarEnabled = Boolean(draft?.isCustomCalendar);
  const [scheduleBundle, setScheduleBundle] = useState(null);
  const [selectedMonthIndex, setSelectedMonthIndex] = useState(0);
  const [creatingMonth, setCreatingMonth] = useState(false);

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
      } else {
        setScheduleBundle(null);
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

  const displayDraft = useMemo(() => {
    if (!draft || !selectedSchedule) return draft;
    const items = (draft.items || []).filter((it) =>
      postingInCustomRange(it.postingDate, selectedSchedule.startDate, selectedSchedule.endDate)
    );
    return { ...draft, items };
  }, [draft, selectedSchedule]);

  const calendarMonthStr = useMemo(() => {
    if (!selectedSchedule?.startDate) return undefined;
    return toYmdUtc(selectedSchedule.startDate).slice(0, 7);
  }, [selectedSchedule]);

  const handleCreateNextMonth = async () => {
    if (!clientId) return;
    try {
      setCreatingMonth(true);
      await api.createNextScheduleMonth(clientId);
      toast.success("Next custom month created");
      await load();
    } catch (err) {
      toast.error(err?.message || "Failed to create month");
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
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={creatingMonth}
                  onClick={() => void handleCreateNextMonth()}
                >
                  {creatingMonth ? "Creating…" : "Create next month"}
                </Button>
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
              key={`${clientId}-${selectedMonthIndex}-${calendarMonthStr || ""}`}
              clientId={clientId}
              month={calendarMonthStr}
              draft={displayDraft}
              onStageMove={moveStage}
              roleCapMap={roleCapMap}
              saving={loading}
              canEdit={customCalendarEnabled}
              isCustomizationMode={false}
              allowPostCreationEdit
              lockPostStage
              weekendMode={weekendMode}
              weekendBlockedConfirmEnabled={customCalendarEnabled}
              onToggleWeekend={setWeekendMode}
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

