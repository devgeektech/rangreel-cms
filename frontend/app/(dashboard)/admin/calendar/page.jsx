"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ReelDetailDialog } from "@/components/reel/ReelDetailDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import EmptyState from "@/components/shared/EmptyState";

const pad2 = (n) => String(n).padStart(2, "0");

function monthToUTCParts(monthStr) {
  const m = String(monthStr || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  if (Number.isNaN(year) || Number.isNaN(monthIndex) || monthIndex < 0 || monthIndex > 11) {
    return null;
  }
  return { year, monthIndex };
}

function toMonthStringUTC(date) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return `${year}-${pad2(month)}`;
}

function shiftMonth(monthStr, delta) {
  const parts = monthToUTCParts(monthStr);
  if (!parts) return monthStr;
  const d = new Date(Date.UTC(parts.year, parts.monthIndex, 1));
  d.setUTCMonth(d.getUTCMonth() + delta);
  return toMonthStringUTC(d);
}

function toYMDUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function parseYMDUTC(ymd) {
  if (!ymd) return null;
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const day = Number(m[3]);
  return new Date(Date.UTC(year, monthIndex, day));
}

function formatDayNumberLabel(day) {
  return String(day);
}

function formatMonthLabel(monthStr) {
  const parts = monthToUTCParts(monthStr);
  if (!parts) return monthStr;
  const d = new Date(Date.UTC(parts.year, parts.monthIndex, 1));
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

function ContentTypeChipIcon({ contentType }) {
  if (contentType === "reel") return <Film className="h-3.5 w-3.5" />;
  if (contentType === "static_post") return <Square className="h-3.5 w-3.5" />;
  if (contentType === "carousel") return <Layers className="h-3.5 w-3.5" />;
  if (contentType === "gmb_post") return <MapPin className="h-3.5 w-3.5" />;
  if (contentType === "campaign") return <Megaphone className="h-3.5 w-3.5" />;
  return <CalendarIcon className="h-3.5 w-3.5" />;
}

const clientColorClasses = [
  "border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-200 dark:border-indigo-400/30",
  "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200 dark:border-rose-400/30",
  "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 dark:border-emerald-400/30",
  "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200 dark:border-amber-400/30",
  "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200 dark:border-sky-400/30",
  "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-200 dark:border-violet-400/30",
];

function overallStatusBadgeVariant(status) {
  if (status === "posted") return { variant: "default", className: "" };
  if (status === "scheduled") return { variant: "outline", className: "border-blue-500/40 text-blue-700 dark:text-blue-200" };
  return { variant: "outline", className: "" };
}

function isCompletedOverallStatus(status) {
  const s = String(status || "").toLowerCase();
  return s === "completed" || s === "posted";
}

export default function AdminCalendarPage() {
  const [month, setMonth] = useState(() => toMonthStringUTC(new Date()));
  const [clients, setClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState("all");
  const [listView, setListView] = useState(false);
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState([]);
  const [openReelDetail, setOpenReelDetail] = useState(false);
  const [selectedContentId, setSelectedContentId] = useState(null);

  const loadClients = async () => {
    try {
      const res = await api.getAdminClients();
      setClients(res?.data || []);
    } catch (error) {
      toast.error(error.message || "Failed to load clients");
    }
  };

  const loadCalendar = async () => {
    try {
      setLoading(true);
      const res = await api.getAdminCalendar(month);
      setGroups(res?.data?.groups || res?.groups || []);
    } catch (error) {
      toast.error(error.message || "Failed to load calendar");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  const groupsFiltered = useMemo(() => {
    if (selectedClientId === "all") return groups;
    // Filter items within each posting-day group.
    return (groups || []).map((g) => ({
      ...g,
      items: (g.items || []).filter((it) => String(it.client?._id || it.client) === String(selectedClientId)),
    }));
  }, [groups, selectedClientId]);

  const allDays = useMemo(() => {
    const parts = monthToUTCParts(month);
    if (!parts) return [];
    const { year, monthIndex } = parts;
    const monthStart = new Date(Date.UTC(year, monthIndex, 1));
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const startDay = monthStart.getUTCDay(); // 0=Sun

    const cells = [];
    const totalCells = Math.ceil((startDay + daysInMonth) / 7) * 7;
    for (let idx = 0; idx < totalCells; idx++) {
      if (idx < startDay) {
        cells.push(null);
      } else {
        const dayNum = idx - startDay + 1;
        if (dayNum > daysInMonth) {
          cells.push(null);
        } else {
          const date = new Date(Date.UTC(year, monthIndex, dayNum));
          cells.push({
            dayNum,
            ymd: toYMDUTC(date),
          });
        }
      }
    }
    return cells;
  }, [month]);

  const itemsByDateKey = useMemo(() => {
    const map = new Map();
    (groupsFiltered || []).forEach((g) => {
      map.set(g.clientPostingDate, g.items || []);
    });
    return map;
  }, [groupsFiltered]);

  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const hasAnyItems = useMemo(() => {
    return (groupsFiltered || []).some((g) => (g.items || []).length > 0);
  }, [groupsFiltered]);

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Global calendar</h2>
          <p className="text-sm text-muted-foreground">
            Read-only view of all clients and content items by posting month (UTC).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="hidden md:flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
            <span className="text-xs text-muted-foreground">Legend</span>
            <span className="inline-flex items-center gap-1 text-xs">
              <span className="h-2 w-2 rounded-full bg-red-600" />
              Urgent
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
              Normal
            </span>
            <span className="inline-flex items-center gap-1 text-xs">
              <span className="h-2 w-2 rounded-full bg-green-600" />
              Completed
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
              Pending
            </span>
          </div>

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

          <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
            <span className="text-sm text-muted-foreground">List view</span>
            <Switch checked={listView} onCheckedChange={setListView} />
          </div>

          <div className="min-w-[220px]">
            <Select value={selectedClientId} onValueChange={setSelectedClientId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Filter by client" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clients</SelectItem>
                {clients.map((c, idx) => (
                  <SelectItem key={c._id || idx} value={c._id}>
                    {c.brandName || c.clientName || "Client"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 28 }).map((_, idx) => (
              <Skeleton key={idx} className="h-28 w-full" />
            ))}
          </div>
        </div>
      ) : !hasAnyItems ? (
        <EmptyState
          title="No calendar items"
          description="Nothing is scheduled for this month."
          icon={CalendarIcon}
        />
      ) : listView ? (
        <div className="space-y-4">
          {(groupsFiltered || [])
            .filter((g) => (g.items || []).length > 0)
            .sort(
              (a, b) =>
                (parseYMDUTC(a.clientPostingDate)?.getTime() || 0) -
                (parseYMDUTC(b.clientPostingDate)?.getTime() || 0)
            )
            .map((g) => (
              <div key={g.clientPostingDate} className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-2 bg-muted/40 flex items-center justify-between">
                  <p className="text-sm font-medium">
                    {new Intl.DateTimeFormat("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                      timeZone: "UTC",
                    }).format(parseYMDUTC(g.clientPostingDate))}
                  </p>
                  <Badge variant="outline">{(g.items || []).length} items</Badge>
                </div>
                <div className="divide-y divide-border">
                  {(g.items || []).map((item) => {
                    const clientId = item.client?._id || item.client;
                    const clientIndex = clients.findIndex((c) => String(c._id) === String(clientId));
                    const baseColorClass =
                      clientColorClasses[Math.max(0, clientIndex === -1 ? 0 : clientIndex) % clientColorClasses.length];
                    const completed = isCompletedOverallStatus(item.overallStatus);
                    const urgent =
                      String(item.planType || item.plan || "").toLowerCase() === "urgent";
                    const colorClass = completed
                      ? "border-green-600/40 bg-green-600/10 text-green-700 dark:text-green-200 dark:border-green-500/40"
                      : urgent
                        ? "border-red-600/40 bg-red-600/10 text-red-700 dark:text-red-200 dark:border-red-500/40"
                        : baseColorClass;

                    const statusVariant = overallStatusBadgeVariant(item.overallStatus);

                    return (
                      <div
                        key={item._id}
                        className="p-4 cursor-pointer hover:bg-muted/20"
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setSelectedContentId(item._id);
                          setOpenReelDetail(true);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedContentId(item._id);
                            setOpenReelDetail(true);
                          }
                        }}
                      >
                        <div className="flex flex-wrap items-center gap-3">
                          <div className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${colorClass}`}>
                            <ContentTypeChipIcon contentType={item.contentType} />
                            <span className="font-medium">{item.client?.brandName || "Client"}</span>
                          </div>

                          <div className="min-w-[200px] flex-1">
                            <p className="font-medium truncate">{item.title}</p>
                            <p className="text-xs text-muted-foreground">{item.contentType}</p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {urgent ? (
                              <Badge variant="outline" className="border-red-500/50 text-red-700 bg-red-500/10 dark:text-red-200">
                                Urgent
                              </Badge>
                            ) : null}
                            <Badge variant={statusVariant.variant} className={statusVariant.className}>
                              {item.overallStatus}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="grid grid-cols-7 gap-0 border-b border-border bg-muted/30">
            {dayNames.map((d) => (
              <div key={d} className="px-3 py-2 text-xs font-medium text-muted-foreground">
                {d}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0">
            {allDays.map((cell, idx) => (
              <div
                key={idx}
                className={`min-h-[110px] border-r border-b border-border p-2 ${cell ? "" : "bg-muted/10"}`}
              >
                {cell ? (
                  <>
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-muted-foreground">{formatDayNumberLabel(cell.dayNum)}</p>
                    </div>
                    <div className="mt-2 space-y-1">
                      {(itemsByDateKey.get(cell.ymd) || []).map((item, j) => {
                        const clientId = item.client?._id || item.client;
                        const clientIndex = clients.findIndex((c) => String(c._id) === String(clientId));
                        const baseColorClass =
                          clientColorClasses[Math.max(0, clientIndex === -1 ? 0 : clientIndex) % clientColorClasses.length];
                        const completed = isCompletedOverallStatus(item.overallStatus);
                        const urgent =
                          String(item.planType || item.plan || "").toLowerCase() === "urgent";
                        const colorClass = completed
                          ? "border-green-600/40 bg-green-600/10 text-green-700 dark:text-green-200 dark:border-green-500/40"
                          : urgent
                            ? "border-red-600/40 bg-red-600/10 text-red-700 dark:text-red-200 dark:border-red-500/40"
                            : baseColorClass;

                        return (
                          <div
                            key={item._id || j}
                            className={`inline-flex w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] ${colorClass} cursor-pointer hover:bg-muted/20`}
                            title={`${item.client?.brandName || "Client"} - ${item.title}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              setSelectedContentId(item._id);
                              setOpenReelDetail(true);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSelectedContentId(item._id);
                                setOpenReelDetail(true);
                              }
                            }}
                          >
                            <ContentTypeChipIcon contentType={item.contentType} />
                            <span className="truncate font-medium">{item.client?.brandName || "Client"}</span>
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
        </div>
      )}

      <ReelDetailDialog
        open={openReelDetail}
        onOpenChange={(v) => {
          setOpenReelDetail(v);
          if (!v) setSelectedContentId(null);
        }}
        contentId={selectedContentId}
        viewerRole="admin"
      />
    </section>
  );
}

