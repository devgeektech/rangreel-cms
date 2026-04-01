"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CalendarDays, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
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
  const [calendarState, setCalendarState] = useState(null);
  const [customizing, setCustomizing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!clientId) return;
    try {
      setLoading(true);
      const res = await api.getInternalCalendar(clientId);
      const next = res?.data || res || null;
      setDraft(next);
      setCalendarState(next);
    } catch (err) {
      toast.error(err.message || "Failed to load internal calendar");
      setDraft(null);
      setCalendarState(null);
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

  const submitCalendar = async () => {
    if (!clientId || !calendarState?.items) return;
    try {
      setSubmitting(true);
      await api.submitInternalCalendar(clientId, { items: calendarState.items });
      toast.success("Schedule saved");
      setCustomizing(false);
      await load();
    } catch (err) {
      toast.error(err?.message || "Failed to save schedule");
    } finally {
      setSubmitting(false);
    }
  };

  const moveStage = async ({ contentId, nextStages }) => {
    await api.patchContentItemStages(contentId, {
      stages: (nextStages || []).map((s) => ({
        stageName: s.name,
        dueDate: s.date,
      })),
    });
  };

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Internal calendar</h2>
          <p className="text-sm text-muted-foreground">
            Auto schedule is read-only. Use “Customize Schedule” to edit stages (warnings only), then submit to persist.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {customizing ? (
            <>
              <Button type="button" variant="outline" onClick={() => { setCustomizing(false); load(); }} disabled={submitting}>
                Cancel
              </Button>
              <Button type="button" onClick={submitCalendar} disabled={submitting}>
                {submitting ? "Saving..." : "Submit schedule"}
              </Button>
            </>
          ) : (
            <Button type="button" onClick={() => setCustomizing(true)} disabled={submitting}>
              Customize Schedule
            </Button>
          )}
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
            <div className={submitting ? "pointer-events-none opacity-75 transition" : ""}>
              <ContentCalendarDnd
                key={clientId}
                clientId={clientId}
                draft={calendarState || draft}
                onCalendarStateChange={setCalendarState}
                onStageMove={moveStage}
                roleCapMap={roleCapMap}
                saving={submitting}
                canEdit={customizing}
                isCustomizationMode={false}
                allowPostCreationEdit
                lockPostStage
                controlledDraft
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Posting commitments</CardTitle>
          <CardDescription>Read-only posting dates per content item.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {((calendarState || draft)?.items || []).map((item) => (
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

