"use client";

import { useMemo } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import { CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";

function toYmd(d) {
  if (!d) return null;
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  const y = x.getUTCFullYear();
  const m = String(x.getUTCMonth() + 1).padStart(2, "0");
  const day = String(x.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function contentTypeKey(ct) {
  return String(ct || "").toLowerCase();
}

function eventStyleForContentType(ct) {
  const k = contentTypeKey(ct);
  if (k === "reel") return { border: "!border-sky-500/40", bg: "!bg-sky-500/10" };
  if (k === "static_post" || k === "post") return { border: "!border-amber-500/40", bg: "!bg-amber-500/10" };
  if (k === "carousel") return { border: "!border-violet-500/40", bg: "!bg-violet-500/10" };
  return { border: "!border-muted-foreground/30", bg: "!bg-muted/30" };
}

/**
 * Month grid of workflow-stage tasks by due date (e.g. Plan or Shoot): reels, posts, carousels.
 */
export function StrategistPlanCalendar({
  monthStr,
  planEntries,
  onSelectEvent,
  headerTitle = "Plan schedule",
  iconClassName = "text-sky-500",
}) {
  const initialDate = useMemo(() => {
    const m = String(monthStr || "").match(/^(\d{4})-(\d{2})$/);
    if (!m) return new Date();
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  }, [monthStr]);

  const events = useMemo(() => {
    return (planEntries || [])
      .map((entry) => {
        const due = entry.stage?.dueDate;
        const ymd = toYmd(due);
        if (!ymd) return null;
        const overdue =
          entry.stage?.dueDate &&
          new Date(entry.stage.dueDate).getTime() < Date.now() - 86400000;
        return {
          id: String(entry.stage._id),
          title: entry.displayId || entry.title || "Plan",
          start: ymd,
          allDay: true,
          extendedProps: { entry, overdue, contentType: entry.contentType },
        };
      })
      .filter(Boolean);
  }, [planEntries]);

  return (
    <div className="strategist-plan-calendar overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium">
        <CalendarDays className={cn("h-4 w-4", iconClassName)} />
        {headerTitle}
      </div>
      <div className="p-2 [&_.fc]:text-sm [&_.fc-button]:rounded-md [&_.fc-button]:border-border [&_.fc-button]:bg-muted [&_.fc-button]:text-foreground [&_.fc-button-primary]:bg-primary [&_.fc-button-primary]:text-primary-foreground [&_.fc-col-header-cell]:border-border [&_.fc-daygrid-day]:border-border [&_.fc-scrollgrid]:border-border [&_.fc-theme-standard_td]:border-border [&_.fc-theme-standard_th]:border-border">
        <FullCalendar
          key={monthStr}
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          initialDate={initialDate}
          events={events}
          headerToolbar={{
            left: "title",
            center: "",
            right: "",
          }}
          height="auto"
          dayMaxEvents={3}
          eventDisplay="block"
          displayEventTime={false}
          eventClick={(info) => {
            info.jsEvent.preventDefault();
            const entry = info.event.extendedProps?.entry;
            if (entry) onSelectEvent?.(entry);
          }}
          eventClassNames={(arg) => {
            const o = arg.event.extendedProps?.overdue;
            const ct = arg.event.extendedProps?.contentType;
            const style = eventStyleForContentType(ct);
            if (o) {
              return ["!border-destructive/50", "!bg-destructive/15"];
            }
            return [style.border, style.bg];
          }}
        />
      </div>
    </div>
  );
}
