"use client";

import { useCallback, useEffect, useState } from "react";
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

export default function ManagerInternalCalendarPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params?.clientId;

  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(null);
  const [roleCapMap, setRoleCapMap] = useState({});
  const [weekendMode, setWeekendMode] = useState(true);
  const [debugMeta, setDebugMeta] = useState(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    try {
      setLoading(true);
      const res = await api.getInternalCalendar(clientId);
      const next = res?.data || res || null;
      setDraft(next);
    } catch (err) {
      toast.error(err.message || "Failed to load internal calendar");
      setDraft(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

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

  const moveStage = async ({ contentId, stageName, newDateYmd, allowWeekend }) => {
    const res = await api.managerDragTask({
      contentId,
      stageName,
      newDate: newDateYmd,
      allowWeekend,
    });
    setDebugMeta(res?.data?.scheduling || null);
    const nextCalendar = res?.data?.calendar || null;
    if (nextCalendar && Array.isArray(nextCalendar.items)) {
      setDraft(nextCalendar);
      return;
    }
    await load();
  };

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Internal calendar</h2>
          <p className="text-sm text-muted-foreground">
            Edits are applied only via global scheduler (`/api/manager/drag-task`). No per-client local save flow.
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
            Month view with color-coded content types, filters, and capacity heatmap by day. Drag a stage to move it; only Plan, Shoot, Edit, and Approval can be moved.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
          ) : (
            <ContentCalendarDnd
              key={clientId}
              clientId={clientId}
              draft={draft}
              onStageMove={moveStage}
              roleCapMap={roleCapMap}
              saving={loading}
              canEdit
              isCustomizationMode={false}
              allowPostCreationEdit
              lockPostStage
              weekendMode={weekendMode}
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

