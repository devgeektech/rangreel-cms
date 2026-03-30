"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { AlertTriangle, Film, GripVertical, Layers, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { applyDragWithChainShift } from "@/lib/calendarDraftUtils";

const pad2 = (n) => String(n).padStart(2, "0");

/** Draft uses `post`; ContentItem uses `static_post` — normalize for filters & legend. */
export function normalizeCalendarContentType(type) {
  if (type === "post") return "static_post";
  if (type === "reel" || type === "carousel") return type;
  return "static_post";
}

export function applyStageDateToDraft(draft, contentId, stageName, newDateYmd) {
  const items = (draft?.items || []).map((item) => {
    if (String(item.contentId) !== String(contentId)) return item;
    return {
      ...item,
      stages: (item.stages || []).map((s) =>
        s.name === stageName ? { ...s, date: newDateYmd } : s
      ),
    };
  });
  return { ...draft, items };
}

const CONTENT_TYPE_META = {
  reel: {
    label: "Reel",
    Icon: Film,
    chip: "border-sky-500/50 bg-sky-500/10 text-sky-900 dark:text-sky-100",
    legend: "bg-sky-500",
  },
  static_post: {
    label: "Static post",
    Icon: Square,
    chip: "border-violet-500/50 bg-violet-500/10 text-violet-900 dark:text-violet-100",
    legend: "bg-violet-500",
  },
  carousel: {
    label: "Carousel",
    Icon: Layers,
    chip: "border-amber-500/50 bg-amber-500/10 text-amber-950 dark:text-amber-100",
    legend: "bg-amber-500",
  },
};

const DEFAULT_EDITABLE = new Set(["Plan", "Shoot", "Edit", "Approval"]);

function parseMonthStr(monthStr) {
  const m = String(monthStr).match(/^(\d{4})-(\d{2})$/);
  if (!m) return { year: new Date().getUTCFullYear(), monthIndex: new Date().getUTCMonth() };
  return { year: Number(m[1]), monthIndex: Number(m[2]) - 1 };
}

function toMonthStringUTC(year, monthIndex) {
  return `${year}-${pad2(monthIndex + 1)}`;
}

function shiftMonthStr(monthStr, delta) {
  const { year, monthIndex } = parseMonthStr(monthStr);
  const d = new Date(Date.UTC(year, monthIndex + delta, 1));
  return toMonthStringUTC(d.getUTCFullYear(), d.getUTCMonth());
}

function formatMonthLabel(monthStr) {
  const { year, monthIndex } = parseMonthStr(monthStr);
  const d = new Date(Date.UTC(year, monthIndex, 1));
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

/** Monday-first week; UTC. */
function getMonthGridCells(year, monthIndex) {
  const first = new Date(Date.UTC(year, monthIndex, 1));
  const last = new Date(Date.UTC(year, monthIndex + 1, 0));
  const daysInMonth = last.getUTCDate();
  const mondayIndex = (first.getUTCDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < mondayIndex; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(`${year}-${pad2(monthIndex + 1)}-${pad2(d)}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  while (cells.length < 42) cells.push(null);
  return cells;
}

function buildStageEntries(draft, editableStages) {
  const editable = editableStages instanceof Set ? editableStages : new Set(editableStages);
  const out = [];
  const counters = { reel: 0, static_post: 0, carousel: 0 };
  for (const item of draft?.items || []) {
    const ct = normalizeCalendarContentType(item.type);
    counters[ct] = (counters[ct] || 0) + 1;
    const contentLabel = `${(CONTENT_TYPE_META[ct] || CONTENT_TYPE_META.static_post).label} ${counters[ct]}`;
    for (const stage of item?.stages || []) {
      if (!stage?.date) continue;
      const ymd = String(stage.date).slice(0, 10);
      const locked = !editable.has(stage.name);
      const assignedUserId = stage?.assignedUser?._id
        ? String(stage.assignedUser._id)
        : stage?.assignedUser
          ? String(stage.assignedUser)
          : "";
      out.push({
        id: `${item.contentId}:${stage.name}`,
        contentId: String(item.contentId),
        stageName: stage.name,
        role: stage.role,
        dateYmd: ymd,
        assignedUserId,
        contentType: ct,
        locked,
        title: item.title || "",
        contentLabel,
      });
    }
  }
  return out;
}

function DayCell({ ymd, padKey, children, isToday, loadStyle, overloadDetail }) {
  const { setNodeRef, isOver } = useDroppable({
    id: ymd ? `day-${ymd}` : `pad-${padKey}`,
    disabled: !ymd,
    data: { ymd },
  });

  if (!ymd) {
    return <div className="min-h-[88px] rounded-md border border-transparent bg-muted/20" />;
  }

  const titleParts = [loadStyle?.title, overloadDetail].filter(Boolean);
  const combinedTitle = titleParts.join(" — ");

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-[88px] flex-col rounded-md border p-1 transition-colors",
        loadStyle?.className,
        overloadDetail && "border-red-600/70 bg-red-500/15 ring-1 ring-red-500/40",
        isOver && "ring-2 ring-primary ring-offset-1"
      )}
      title={combinedTitle || undefined}
    >
      <div className="mb-0.5 flex items-center justify-between gap-1">
        <span
          className={cn(
            "inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded text-[11px] font-medium",
            isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground"
          )}
        >
          {Number(ymd.slice(8, 10))}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto">{children}</div>
    </div>
  );
}

function StageChip({ entry, filterType, saving, canEdit, warnings, onOpenDetails }) {
  const meta = CONTENT_TYPE_META[entry.contentType] || CONTENT_TYPE_META.static_post;
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: entry.id,
    disabled: entry.locked || saving || !canEdit,
    data: {
      contentId: entry.contentId,
      stageName: entry.stageName,
      dateYmd: entry.dateYmd,
      locked: entry.locked,
    },
  });

  if (filterType !== "all" && entry.contentType !== filterType) {
    return null;
  }

  const hasWarnings = Array.isArray(warnings) && warnings.length > 0;
  const warningTitle = hasWarnings
    ? warnings.map((w) => w.message || `${w.role}: ${w.effectiveCount}/${w.capacity}`).join(" · ")
    : undefined;
  const hoverTitle = [
    entry.contentLabel ? `${entry.contentLabel}` : meta.label,
    `${entry.stageName} · ${entry.role}`,
    warningTitle ? `Warnings: ${warningTitle}` : "",
  ]
    .filter(Boolean)
    .join(" — ");

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      title={hoverTitle}
      className={cn(
        "flex items-start gap-0.5 rounded border px-1 py-0.5 text-[10px] leading-tight",
        meta.chip,
        hasWarnings && "border-red-600/70 bg-red-500/10 ring-1 ring-red-500/20",
        (entry.locked || saving) && "opacity-70",
        isDragging && "opacity-40"
      )}
    >
      {!entry.locked && !saving && canEdit ? (
        <button
          type="button"
          className="mt-0.5 shrink-0 cursor-grab touch-none text-current/70 active:cursor-grabbing"
          {...listeners}
          {...attributes}
          aria-label="Drag to reschedule"
        >
          <GripVertical className="h-3 w-3" />
        </button>
      ) : (
        <span className="mt-0.5 w-3 shrink-0" />
      )}
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => {
          if (isDragging) return;
          onOpenDetails?.(entry);
        }}
      >
        <div className="font-medium">{meta.label}</div>
        <div className="truncate text-[9px] opacity-90">
          {(entry.contentLabel || meta.label) + " · "}{entry.stageName} · {entry.role}
        </div>
      </button>
      {hasWarnings ? <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-red-600" aria-hidden /> : null}
    </div>
  );
}

function StageChipOverlay({ entry }) {
  const meta = CONTENT_TYPE_META[entry.contentType] || CONTENT_TYPE_META.static_post;
  return (
    <div
      className={cn(
        "flex max-w-[140px] items-start gap-0.5 rounded border px-1 py-0.5 text-[10px] shadow-md",
        meta.chip
      )}
    >
      <GripVertical className="mt-0.5 h-3 w-3 shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">{meta.label}</div>
        <div className="truncate text-[9px] opacity-90">
          {entry.stageName} · {entry.role}
        </div>
      </div>
    </div>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Month grid calendar with drag-and-drop between days. Aligns with client schedule draft
 * (`post` ↔ `static_post`) and internal calendar API.
 *
 * @param {object} props
 * @param {{ clientId?: string, items: object[] }} props.draft - Schedule draft from API
 * @param {string} [props.month] - Controlled month `YYYY-MM`
 * @param {(m: string) => void} [props.onMonthChange]
 * @param {'all'|'reel'|'static_post'|'carousel'} [props.filterType]
 * @param {(f: 'all'|'reel'|'static_post'|'carousel') => void} [props.onFilterChange]
 * @param {(args: { contentId: string, stageName: string, newDateYmd: string, previousYmd: string }) => Promise<void>} props.onStageMove - Persist move (e.g. updateInternalCalendarStage)
 * @param {(nextDraft: object) => void} [props.onCalendarStateChange] - Emits draft after successful move
 * @param {Set<string>|string[]} [props.editableStageNames] - Stages that can be dragged; default matches backend
 * @param {Record<string, number>} [props.roleCapMap] - Optional role → daily capacity for heatmap
 * @param {boolean} [props.saving]
 * @param {string} [props.clientId] - When set, POST /calendar/check-conflicts after changes (warn-only overload UI)
 */
export default function ContentCalendarDnd({
  draft,
  month: controlledMonth,
  onMonthChange,
  filterType: controlledFilter,
  onFilterChange,
  onStageMove,
  onCalendarStateChange,
  editableStageNames = DEFAULT_EDITABLE,
  roleCapMap = {},
  saving = false,
  clientId,
  conflictMode = "existing",
  canEdit = true,
  controlledDraft = false,
  userById = {},
}) {
  const defaultMonth = useMemo(() => {
    const items = draft?.items || [];
    for (const it of items) {
      for (const s of it?.stages || []) {
        if (s?.date) return String(s.date).slice(0, 7);
      }
    }
    return toMonthStringUTC(new Date().getUTCFullYear(), new Date().getUTCMonth());
  }, [draft]);

  const [innerMonth, setInnerMonth] = useState(defaultMonth);
  const [innerFilter, setInnerFilter] = useState("all");
  const [localDraft, setLocalDraft] = useState(draft);
  const [conflictByDay, setConflictByDay] = useState({});
  const monthInitRef = useRef(false);
  const conflictReqRef = useRef(0);

  const viewMonth = controlledMonth ?? innerMonth;
  const filterType = controlledFilter ?? innerFilter;

  useEffect(() => {
    if (!controlledDraft) setLocalDraft(draft);
  }, [draft, controlledDraft]);

  const schedule = controlledDraft ? draft : localDraft;

  useEffect(() => {
    if (!(schedule?.items || []).length) {
      setConflictByDay({});
      return undefined;
    }

    if (conflictMode === "existing" && !clientId) {
      setConflictByDay({});
      return undefined;
    }

    const seq = ++conflictReqRef.current;
    const t = setTimeout(async () => {
      try {
        const requestBody = { items: schedule.items };
        const res =
          conflictMode === "new"
            ? await api.checkCalendarConflictsNew(requestBody)
            : await api.checkCalendarConflicts({ clientId, ...requestBody });
        const respPayload = res?.data ?? res;
        const byDay = respPayload?.byDay || {};
        if (seq === conflictReqRef.current) setConflictByDay(byDay);
      } catch {
        if (seq === conflictReqRef.current) setConflictByDay({});
      }
    }, 320);
    return () => clearTimeout(t);
  }, [clientId, schedule, conflictMode]);

  useEffect(() => {
    if (controlledMonth) return;
    if (monthInitRef.current) return;
    if (!(draft?.items || []).length) return;
    setInnerMonth(defaultMonth);
    monthInitRef.current = true;
  }, [draft, defaultMonth, controlledMonth]);

  const setMonth = useCallback(
    (m) => {
      if (onMonthChange) onMonthChange(m);
      else setInnerMonth(m);
    },
    [onMonthChange]
  );

  const setFilter = useCallback(
    (f) => {
      if (onFilterChange) onFilterChange(f);
      else setInnerFilter(f);
    },
    [onFilterChange]
  );

  const { year, monthIndex } = parseMonthStr(viewMonth);
  const gridCells = useMemo(() => getMonthGridCells(year, monthIndex), [year, monthIndex]);

  const editable = useMemo(
    () => (editableStageNames instanceof Set ? editableStageNames : new Set(editableStageNames)),
    [editableStageNames]
  );

  const entries = useMemo(() => buildStageEntries(schedule, editable), [schedule, editable]);

  const entriesByDay = useMemo(() => {
    const map = new Map();
    for (const e of entries) {
      const list = map.get(e.dateYmd) || [];
      list.push(e);
      map.set(e.dateYmd, list);
    }
    return map;
  }, [entries]);

  const DEFAULT_CAP = 5;
  const dayLoadStyle = useCallback(
    (ymd) => {
      let tasks = 0;
      let capacity = 0;
      for (const item of schedule?.items || []) {
        for (const stage of item?.stages || []) {
          if (!stage?.date || String(stage.date).slice(0, 10) !== ymd) continue;
          const role = String(stage.role);
          const cap = Number(roleCapMap[role]);
          const roleCap = Number.isFinite(cap) && cap >= 0 ? cap : DEFAULT_CAP;
          tasks += 1;
          capacity += roleCap;
        }
      }
      const ratio = capacity > 0 ? tasks / capacity : 0;
      const title =
        capacity > 0 ? `${tasks}/${capacity} task slots (by role capacity)` : "No capacity data";
      if (ratio >= 1)
        return {
          className: "border-red-500/30 bg-red-500/10",
          title,
        };
      if (ratio >= 0.6)
        return {
          className: "border-amber-500/30 bg-amber-500/10",
          title,
        };
      return {
        className: "border-emerald-500/25 bg-emerald-500/10",
        title,
      };
    },
    [schedule, roleCapMap]
  );

  const todayYmd = useMemo(() => {
    const d = new Date();
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    })
  );

  const [activeDragId, setActiveDragId] = useState(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsEntry, setDetailsEntry] = useState(null);
  const activeEntry = useMemo(
    () => entries.find((e) => e.id === activeDragId) || null,
    [entries, activeDragId]
  );
  const detailsItem = useMemo(() => {
    if (!detailsEntry) return null;
    return (schedule?.items || []).find((it) => String(it.contentId) === String(detailsEntry.contentId)) || null;
  }, [detailsEntry, schedule]);

  const resolveUserName = useCallback(
    (assignedUser) => {
      if (!assignedUser) return "-";
      if (typeof assignedUser === "object") return assignedUser?.name || assignedUser?._id || "-";
      const id = String(assignedUser);
      return userById?.[id]?.name || userById?.[id] || id;
    },
    [userById]
  );

  const openDetails = useCallback((entry) => {
    setDetailsEntry(entry);
    setDetailsOpen(true);
  }, []);

  const handleDragEnd = async (event) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;
    if (!canEdit) return;

    const data = active.data.current;
    if (!data || data.locked) return;

    const overId = String(over.id);
    if (!overId.startsWith("day-")) return;
    const newYmd = overId.slice(4);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newYmd)) return;
    if (newYmd === data.dateYmd) return;

    const prev = schedule;
    const optimistic = applyDragWithChainShift(prev, data.contentId, data.stageName, newYmd);

    if (controlledDraft) {
      onCalendarStateChange?.(optimistic);
    } else {
      setLocalDraft(optimistic);
      onCalendarStateChange?.(optimistic);
    }

    if (!onStageMove) return;

    try {
      await onStageMove({
        contentId: data.contentId,
        stageName: data.stageName,
        newDateYmd: newYmd,
        previousYmd: data.dateYmd,
      });
    } catch {
      if (controlledDraft) onCalendarStateChange?.(prev);
      else setLocalDraft(prev);
      onCalendarStateChange?.(prev);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setMonth(shiftMonthStr(viewMonth, -1))}>
            Previous
          </Button>
          <span className="min-w-[10rem] text-center text-sm font-semibold">{formatMonthLabel(viewMonth)}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setMonth(shiftMonthStr(viewMonth, 1))}>
            Next
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {[
            { key: "all", label: "All types" },
            { key: "reel", label: "Reel" },
            { key: "static_post", label: "Static" },
            { key: "carousel", label: "Carousel" },
          ].map(({ key, label }) => (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={filterType === key ? "default" : "outline"}
              onClick={() => setFilter(key)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 border-t border-b py-3">
        <span className="text-xs font-medium text-muted-foreground">Content types</span>
        {(["reel", "static_post", "carousel"]).map((k) => {
          const m = CONTENT_TYPE_META[k];
          return (
            <Badge key={k} variant="outline" className="gap-1.5 font-normal">
              <span className={cn("h-2 w-2 rounded-full", m.legend)} aria-hidden />
              {m.label}
            </Badge>
          );
        })}
        <span className="text-xs font-medium text-muted-foreground">Day load</span>
        <Badge variant="outline" className="border-emerald-500/40 font-normal">
          <span className="mr-1 h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
          Lower
        </Badge>
        <Badge variant="outline" className="border-amber-500/40 font-normal">
          <span className="mr-1 h-2 w-2 rounded-full bg-amber-500" aria-hidden />
          Medium
        </Badge>
        <Badge variant="outline" className="border-red-500/40 font-normal">
          <span className="mr-1 h-2 w-2 rounded-full bg-red-500" aria-hidden />
          Busy
        </Badge>
        <Badge variant="outline" className="border-red-600/60 font-normal">
          <span className="mr-1 h-2 w-2 rounded-full bg-red-600" aria-hidden />
          Capacity warning
        </Badge>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={({ active }) => setActiveDragId(String(active.id))}
        onDragCancel={() => setActiveDragId(null)}
        onDragEnd={handleDragEnd}
      >
        <div className="overflow-x-auto">
          <div className="grid min-w-[640px] grid-cols-7 gap-1">
            {WEEKDAYS.map((d) => (
              <div key={d} className="pb-1 text-center text-[11px] font-medium text-muted-foreground">
                {d}
              </div>
            ))}
            {gridCells.map((ymd, idx) => {
              const loadStyle = ymd ? dayLoadStyle(ymd) : null;
              const list = ymd ? entriesByDay.get(ymd) || [] : [];
              const dayWarnings = ymd && conflictByDay[ymd] ? conflictByDay[ymd] : [];
              const overloadDetail =
                dayWarnings.length > 0
                  ? dayWarnings.map((w) => w.message || `${w.role}: ${w.effectiveCount}/${w.capacity}`).join(" · ")
                  : "";
              return (
                <DayCell
                  key={ymd || `pad-${idx}`}
                  padKey={idx}
                  ymd={ymd}
                  isToday={ymd === todayYmd}
                  loadStyle={loadStyle}
                  overloadDetail={overloadDetail}
                >
                  {list.map((entry) => (
                    <StageChip
                      key={entry.id}
                      entry={entry}
                      filterType={filterType}
                      saving={saving}
                      canEdit={canEdit}
                      onOpenDetails={openDetails}
                      warnings={dayWarnings.filter(
                        (w) =>
                          String(w.role) === String(entry.role) &&
                          String(w.userId || "") === String(entry.assignedUserId || "")
                      )}
                    />
                  ))}
                </DayCell>
              );
            })}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>{activeEntry ? <StageChipOverlay entry={activeEntry} /> : null}</DragOverlay>
      </DndContext>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detailsEntry?.contentLabel || "Task details"}</DialogTitle>
            <DialogDescription>
              {detailsEntry ? `${detailsEntry.stageName} · ${detailsEntry.role}` : ""}
            </DialogDescription>
          </DialogHeader>

          {detailsEntry ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Due date</span>
                <span className="font-medium">{detailsEntry.dateYmd}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Assigned to</span>
                <span className="font-medium">
                  {resolveUserName(
                    detailsItem?.stages?.find((s) => s?.name === detailsEntry.stageName)?.assignedUser
                  )}
                </span>
              </div>
              {detailsItem?.postingDate ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Posting date</span>
                  <span className="font-medium">{String(detailsItem.postingDate).slice(0, 10)}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  );
}
