"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Film,
  Layers,
  Megaphone,
  MapPin,
  Square,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/shared/EmptyState";

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

function contentTypeIcon(contentType) {
  if (contentType === "reel") return Film;
  if (contentType === "static_post") return Square;
  if (contentType === "carousel") return Layers;
  if (contentType === "gmb_post") return MapPin;
  if (contentType === "campaign") return Megaphone;
  return CalendarIcon;
}

const clientColorClasses = [
  "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-200 dark:border-indigo-400/30",
  "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200 dark:border-rose-400/30",
  "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 dark:border-emerald-400/30",
  "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200 dark:border-amber-400/30",
  "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200 dark:border-sky-400/30",
  "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-200 dark:border-violet-400/30",
];

export default function ManagerGlobalCalendarPage() {
  const router = useRouter();
  const [month, setMonth] = useState(() => toMonthStringUTC(new Date()));
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState([]);

  const loadCalendar = async () => {
    try {
      setLoading(true);
      const res = await api.getManagerGlobalCalendar(month);
      setGroups(res?.data?.groups || res?.groups || []);
    } catch (error) {
      toast.error(error.message || "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const clientsList = useMemo(() => {
    const map = new Map();
    (groups || []).forEach((g) => {
      (g.items || []).forEach((item) => {
        const c = item.client;
        if (c && c._id) {
          map.set(String(c._id), c);
        }
      });
    });
    return [...map.values()];
  }, [groups]);

  const colorByClientId = useMemo(() => {
    const map = new Map();
    clientsList.forEach((c, idx) => {
      map.set(String(c._id), clientColorClasses[idx % clientColorClasses.length]);
    });
    return map;
  }, [clientsList]);

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

  const itemsByDay = useMemo(() => {
    const map = new Map();
    (groups || []).forEach((g) => {
      map.set(g.clientPostingDate, g.items || []);
    });
    return map;
  }, [groups]);

  const hasItems = useMemo(() => {
    return (groups || []).some((g) => (g.items || []).length > 0);
  }, [groups]);

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Global Calendar</h2>
          <p className="text-sm text-muted-foreground">Posting dates across all your clients (read-only).</p>
        </div>

        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground mr-2">
            <span className="h-2 w-2 rounded-full bg-red-600" />
            Urgent
          </span>
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
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 28 }).map((_, idx) => (
              <Skeleton key={idx} className="h-24 w-full" />
            ))}
          </div>
        </div>
      ) : !hasItems ? (
        <EmptyState
          icon={CalendarIcon}
          title="No calendar items"
          description="Nothing is scheduled for this month yet."
        />
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="grid grid-cols-7 gap-0 border-b border-border bg-muted/30">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                <div key={d} className="px-3 py-2 text-xs font-medium text-muted-foreground">
                  {d}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-0">
              {calendarCells.map((cell, idx) => (
                <div key={idx} className={`min-h-[110px] border-b border-r border-border p-2 ${cell ? "" : "bg-muted/10"}`}>
                  {cell ? (
                    <>
                      <p className="text-xs font-medium text-muted-foreground">{cell.dayNum}</p>
                      <div className="mt-2 space-y-1">
                        {(itemsByDay.get(cell.ymd) || []).map((item) => {
                          const clientId = item.client?._id;
                          const baseColorClass = clientId ? colorByClientId.get(String(clientId)) : clientColorClasses[0];
                          const isUrgent =
                            String(item.planType || item.plan || "").toLowerCase() === "urgent";
                          const colorClass = isUrgent
                            ? "border-red-600/40 bg-red-600/10 text-red-700 dark:text-red-200 dark:border-red-500/40"
                            : baseColorClass;
                          const Icon = contentTypeIcon(item.contentType);
                          return (
                            <button
                              key={item._id}
                              type="button"
                              className={`inline-flex w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${colorClass}`}
                              onClick={() => {
                                const destId = item.client?._id;
                                if (destId) router.push(`/manager/clients/${destId}`);
                              }}
                              title={`${item.client?.brandName || "Client"} • ${item.contentType} • ${item.title}`}
                            >
                              <Icon className="h-3.5 w-3.5" />
                              <span className="truncate font-medium">{item.client?.brandName || "Client"}</span>
                              {isUrgent ? <span className="ml-auto text-[10px] font-semibold">U</span> : null}
                            </button>
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
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Legend</CardTitle>
              <p className="text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-red-600" />
                  Urgent
                </span>
                <span className="mx-2 text-border">·</span>
                Default chip color = Normal
              </p>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {clientsList.map((c) => (
                <div
                  key={c._id}
                  className={`inline-flex items-center gap-2 rounded-lg border px-2 py-1 text-xs ${
                    colorByClientId.get(String(c._id)) || clientColorClasses[0]
                  }`}
                >
                  <span className="font-medium">{c.brandName || c.clientName || "Client"}</span>
                  <Badge variant="outline" className="bg-transparent">
                    {String(c._id).slice(-4)}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}

