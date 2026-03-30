"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CalendarDays, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  const [savingKey, setSavingKey] = useState("");
  const [roleCapMap, setRoleCapMap] = useState({});
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [pendingStageEdit, setPendingStageEdit] = useState(null);
  const [calendarState, setCalendarState] = useState(null);

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

  const updateStage = async (contentId, stageName, newDateYMD) => {
    const opKey = `${contentId}:${stageName}`;
    try {
      setSavingKey(opKey);
      const res = await api.updateInternalCalendarStage({
        contentId,
        stageName,
        newDate: newDateYMD,
      });
      if (res?.success === false) {
        const suggestions = Array.isArray(res?.suggestions) ? res.suggestions : [];
        if (suggestions.length > 0) {
          setSuggestions(suggestions);
          setPendingStageEdit({ contentId, stageName });
          setSuggestionsOpen(true);
          throw new Error(`capacity_suggestions:${suggestions.join(",")}`);
        }
        throw new Error("capacity_exceeded");
      }
      toast.success("Stage date updated");
      await load();
    } catch (err) {
      if (String(err?.message || "").startsWith("capacity_suggestions")) {
        return;
      }
      if (
        String(err?.message || "").toLowerCase().includes("capacity exceeded") ||
        String(err?.message || "").startsWith("capacity_exceeded")
      ) {
        toast.error("Capacity exceeded for this role");
      } else {
        toast.error(err.message || "Failed to update stage date");
      }
      throw err;
    } finally {
      setSavingKey("");
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Internal calendar</h2>
          <p className="text-sm text-muted-foreground">
            Drag stages between days to reschedule. Post and design stages stay fixed. Calendar state updates after each save.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
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
            <div className={savingKey ? "pointer-events-none opacity-75 transition" : ""}>
              <ContentCalendarDnd
                key={clientId}
                clientId={clientId}
                draft={calendarState || draft}
                onCalendarStateChange={setCalendarState}
                roleCapMap={roleCapMap}
                saving={Boolean(savingKey)}
                onStageMove={async ({ contentId, stageName, newDateYmd }) => {
                  await updateStage(contentId, stageName, newDateYmd);
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={suggestionsOpen} onOpenChange={setSuggestionsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Selected date is full</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Suggested dates:</p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((date, idx) => (
                <Button
                  key={date}
                  type="button"
                  variant={idx === 0 ? "default" : "outline"}
                  onClick={async () => {
                    if (!pendingStageEdit) return;
                    await updateStage(
                      pendingStageEdit.contentId,
                      pendingStageEdit.stageName,
                      date
                    );
                    setSuggestionsOpen(false);
                    setSuggestions([]);
                    setPendingStageEdit(null);
                  }}
                >
                  {prettyDate(date)}
                </Button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

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

