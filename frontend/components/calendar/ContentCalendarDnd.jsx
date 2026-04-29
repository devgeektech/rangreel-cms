"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
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
import { AlertTriangle, CalendarDays, Film, GripVertical, Layers, Square } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import { toast } from "sonner";
import { applyCustomizationDrag, applyManagerEditDrag } from "@/lib/calendarDraftUtils";
import { classifyWeekendStageMove } from "@/lib/calendarWeekendValidation";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

const DEFAULT_EDITABLE = new Set(["Plan", "Shoot", "Edit", "Approval", "Post"]);

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

function isWeekendYmd(ymd) {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return false;
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function addDaysYmd(ymd, days) {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  d.setUTCDate(d.getUTCDate() + days);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function monthKeyFromYmd(ymd) {
  const m = String(ymd || "").match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!m) return "";
  return `${m[1]}-${m[2]}`;
}

function shiftMonthKey(monthKey, delta) {
  const m = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return "";
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (!Number.isFinite(y) || !Number.isFinite(mo)) return "";
  const d = new Date(Date.UTC(y, mo - 1 + Number(delta || 0), 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
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
    const numberedLabel = `${(CONTENT_TYPE_META[ct] || CONTENT_TYPE_META.static_post).label} ${counters[ct]}`;
    const contentLabel = String(item.displayId || numberedLabel);
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
        isCustomCalendar: item?.isCustomCalendar !== false,
        locked,
        title: item.title || "",
        contentLabel,
      });
    }
  }
  return out;
}

function DayCell({
  ymd,
  padKey,
  children,
  isToday,
  loadStyle,
  overloadDetail,
  warningSeverity = "none",
  invalidDrop,
  invalidReason,
  validDrop,
  previewHint,
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: ymd ? `day-${ymd}` : `pad-${padKey}`,
    disabled: !ymd,
    data: { ymd },
  });

  if (!ymd) {
    return <div className="min-h-[88px] rounded-md border border-transparent bg-muted/20" />;
  }

  const titleParts = [loadStyle?.title, overloadDetail, invalidReason, previewHint].filter(Boolean);
  const combinedTitle = titleParts.join(" — ");

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-[88px] flex-col rounded-md border p-1 transition-colors",
        loadStyle?.className,
        overloadDetail &&
          (warningSeverity === "overloaded"
            ? "border-red-600/70 bg-red-500/15 ring-1 ring-red-500/40"
            : "border-blue-600/70 bg-blue-500/15 ring-1 ring-blue-500/40"),
        validDrop && "border-emerald-600/80 bg-emerald-500/20 ring-2 ring-emerald-500/50",
        invalidDrop && "border-red-600/80 bg-red-500/20 ring-2 ring-red-500/60",
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

function StageChip({
  entry,
  filterType,
  stageFilter = "all",
  saving,
  canEdit,
  isCustomizationMode,
  lockPostStage,
  warnings,
  onOpenDetails,
  onQuickMove,
}) {
  const meta = CONTENT_TYPE_META[entry.contentType] || CONTENT_TYPE_META.static_post;
  const postLocked = lockPostStage && entry.stageName === "Post";
  const dragDisabled =
    entry.locked ||
    saving ||
    !canEdit ||
    postLocked ||
    (!isCustomizationMode && !entry.isCustomCalendar);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: entry.id,
    disabled: dragDisabled,
    data: {
      contentId: entry.contentId,
      stageName: entry.stageName,
      dateYmd: entry.dateYmd,
      locked: entry.locked,
      isCustomCalendar: entry.isCustomCalendar,
      role: entry.role,
    },
  });

  if (filterType !== "all" && entry.contentType !== filterType) {
    return null;
  }

  if (stageFilter !== "all" && entry.stageName !== stageFilter) {
    return null;
  }


  const hasWarnings = Array.isArray(warnings) && warnings.length > 0;
  const hasOverloadedWarning = hasWarnings
    ? warnings.some((w) => Number(w?.effectiveCount) > Number(w?.capacity))
    : false;
  const warningTitle = hasWarnings
    ? warnings.map((w) => w.message || `${w.role}: ${w.effectiveCount}/${w.capacity}`).join(" · ")
    : undefined;
  const hoverTitle = [
    entry.contentLabel ? `${entry.contentLabel}` : meta.label,
    `${entry.stageName} · ${entry.role}`,
    isCustomizationMode && (entry.stageName === "Plan" || entry.stageName === "Post")
      ? "Dragging this will shift entire timeline"
      : "",
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
        "group flex items-start gap-0.5 rounded border px-1 py-0.5 text-[10px] leading-tight",
        meta.chip,
        hasWarnings &&
          (hasOverloadedWarning
            ? "border-red-600/70 bg-red-500/10 ring-1 ring-red-500/20"
            : "border-blue-600/70 bg-blue-500/10 ring-1 ring-blue-500/20"),
        (entry.locked || saving) && "opacity-70",
        isDragging && "opacity-40"
      )}
    >
      {!dragDisabled ? (
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
          {(entry.contentLabel || meta.label) + " · "}
          {entry.stageName} · {entry.role}
        </div>
        {isCustomizationMode && entry.stageName === "Plan" ? (
          <div className="mt-0.5 text-[9px] text-muted-foreground">Plan — Moves only this stage</div>
        ) : null}
        {isCustomizationMode && entry.stageName === "Post" ? (
          <div className="mt-0.5 text-[9px] text-muted-foreground">Post — Controls final date</div>
        ) : null}
        {!isCustomizationMode && postLocked ? (
          <div className="mt-0.5 text-[9px] text-muted-foreground">Post (Locked)</div>
        ) : null}
      </button>
      {hasWarnings ? (
        <AlertTriangle
          className={cn(
            "mt-0.5 h-3 w-3 shrink-0",
            hasOverloadedWarning ? "text-red-600" : "text-blue-600"
          )}
          aria-hidden
        />
      ) : null}
      {!dragDisabled ? (
        <button
          type="button"
          className="mt-0.5 shrink-0 text-current/70 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onQuickMove?.(entry);
          }}
          title="Quick move to date"
          aria-label="Quick move to date"
        >
          <CalendarDays className="h-3 w-3" />
        </button>
      ) : null}
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
  isCustomizationMode = false,
  allowPostCreationEdit = false,
  lockPostStage = false,
  weekendMode = true,
  /** When true, dropping on a weekend while weekend mode is OFF opens a confirmation modal (custom calendar only). Defaults to customization preview mode; set explicitly for internal calendar. */
  weekendBlockedConfirmEnabled,
  onToggleWeekend,
  showWeekendToggle = true,
  /** 'all' | stage name — hide chips except this stage when not 'all' */
  stageFilter = "all",
  onStageFilterChange,
  /** When true, show a second row of stage chips (e.g. Post-only default during customize). */
  showStageFilterBar = false,
  /** Pre-creation client customize: earliest allowed calendar day for any stage (YYYY-MM-DD). */
  customizationMinStageDateYmd = "",
}) {
  const pathname = usePathname();
  const hideWeekendToggleForPreClient = pathname === "/manager/clients/new";
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

  const setStageFilter = useCallback(
    (f) => {
      onStageFilterChange?.(f);
    },
    [onStageFilterChange]
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
      if (ratio > 1)
        return {
          className: "border-red-500/35 bg-red-500/12",
          title: `${title} — overloaded`,
        };
      if (ratio === 1)
        return {
          className: "border-orange-500/35 bg-orange-500/12",
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
  const [invalidDropYmd, setInvalidDropYmd] = useState("");
  const [validDropYmd, setValidDropYmd] = useState("");
  const [dropError, setDropError] = useState("");
  const [invalidDropReason, setInvalidDropReason] = useState("");
  const [previewHint, setPreviewHint] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailsEntry, setDetailsEntry] = useState(null);
  const [detailsMoveToYmd, setDetailsMoveToYmd] = useState("");
  const [weekendConfirmOpen, setWeekendConfirmOpen] = useState(false);
  const [pendingWeekendMove, setPendingWeekendMove] = useState(null);
  const activeEntry = useMemo(
    () => entries.find((e) => e.id === activeDragId) || null,
    [entries, activeDragId]
  );
  const detailsItem = useMemo(() => {
    if (!detailsEntry) return null;
    return (schedule?.items || []).find((it) => String(it.contentId) === String(detailsEntry.contentId)) || null;
  }, [detailsEntry, schedule]);
  const detailStage = useMemo(() => {
    if (!detailsEntry || !detailsItem) return null;
    return (detailsItem?.stages || []).find((s) => String(s?.name) === String(detailsEntry.stageName)) || null;
  }, [detailsEntry, detailsItem]);
  const detailWarnings = useMemo(() => {
    if (!detailsEntry) return [];
    const dayWarn = conflictByDay?.[detailsEntry.dateYmd] || [];
    return dayWarn.filter(
      (w) =>
        String(w.role || "") === String(detailsEntry.role || "") &&
        String(w.userId || "") === String(detailsEntry.assignedUserId || "")
    );
  }, [detailsEntry, conflictByDay]);
  const detailSuggestions = useMemo(() => {
    if (!detailsEntry) return [];
    const out = [];
    if (detailsEntry.stageName === "Post") out.push("Move only to a date in the previous month.");
    if (!weekendMode) out.push("Weekend mode is OFF. Turning it ON may unlock dates.");
    return out;
  }, [detailsEntry, detailWarnings, weekendMode]);

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
    setDetailsMoveToYmd(String(entry?.dateYmd || "").slice(0, 10));
    setDetailsOpen(true);
  }, []);
  const resolveUseWeekendConfirm = useCallback(
    (entryIsCustom) =>
      (weekendBlockedConfirmEnabled ?? isCustomizationMode) &&
      schedule?.isCustomCalendar !== false &&
      entryIsCustom !== false,
    [weekendBlockedConfirmEnabled, isCustomizationMode, schedule?.isCustomCalendar]
  );

  const runMoveForEntry = useCallback(
    async (entry, targetYmd, { forceWeekend = false } = {}) => {
      if (!entry) return;
      const ymd = String(targetYmd || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
        throw new Error("Please use YYYY-MM-DD format");
      }
      if (!forceWeekend) {
        const customizationOpts =
          isCustomizationMode && customizationMinStageDateYmd
            ? {
                minStageDateYmd: String(customizationMinStageDateYmd).slice(0, 10),
                weekendEnabled: weekendMode,
              }
            : { weekendEnabled: weekendMode };
        const classification = classifyWeekendStageMove({
          schedule,
          contentId: entry.contentId,
          stageName: entry.stageName,
          newYmd: ymd,
          weekendMode,
          useWeekendConfirm: resolveUseWeekendConfirm(entry.isCustomCalendar),
          isCustomizationMode,
          customizationOpts,
          applyCustomizationDrag,
          applyManagerEditDrag,
        });
        if (classification.kind === "hard_block") {
          throw new Error("Weekend dates are blocked");
        }
        if (classification.kind === "error") {
          throw new Error(classification.message || "Invalid move");
        }
        if (classification.kind === "confirm") {
          setPendingWeekendMove({ source: "entry", entry, newYmd: ymd });
          setWeekendConfirmOpen(true);
          return "confirm_opened";
        }
      }
      if (!onStageMove) {
        const customizationOpts =
          isCustomizationMode && customizationMinStageDateYmd
            ? {
                minStageDateYmd: String(customizationMinStageDateYmd).slice(0, 10),
                weekendEnabled: forceWeekend || weekendMode,
              }
            : { weekendEnabled: forceWeekend || weekendMode };
        const moved = isCustomizationMode
          ? applyCustomizationDrag(schedule, entry.contentId, entry.stageName, ymd, customizationOpts)
          : applyManagerEditDrag(schedule, entry.contentId, entry.stageName, ymd);
        if (moved?.blocked) {
          throw new Error(moved.reason || "Invalid move");
        }
        if (typeof onCalendarStateChange === "function" && moved?.draft) {
          onCalendarStateChange(moved.draft);
        }
        return;
      }
      await onStageMove({
        contentId: entry.contentId,
        stageName: entry.stageName,
        newDateYmd: ymd,
        previousYmd: entry.dateYmd,
        allowWeekend: forceWeekend || weekendMode,
      });
    },
    [
      onStageMove,
      weekendMode,
      schedule,
      isCustomizationMode,
      customizationMinStageDateYmd,
      resolveUseWeekendConfirm,
      onCalendarStateChange,
    ]
  );

  const confirmWeekendMove = useCallback(async () => {
    const pending = pendingWeekendMove;
    if (!pending) return;
    try {
      if (pending.source === "drag") {
        const { data, newYmd } = pending;
        const customizationOpts =
          isCustomizationMode && customizationMinStageDateYmd
            ? {
                minStageDateYmd: String(customizationMinStageDateYmd).slice(0, 10),
                weekendEnabled: true,
              }
            : { weekendEnabled: true };
        const moved = isCustomizationMode
          ? applyCustomizationDrag(schedule, data.contentId, data.stageName, newYmd, customizationOpts)
          : applyManagerEditDrag(schedule, data.contentId, data.stageName, newYmd);
        if (moved.blocked) {
          toast.error(moved.reason || "Invalid move");
          return;
        }
        if (!onStageMove) {
          if (typeof onCalendarStateChange === "function" && moved?.draft) {
            onCalendarStateChange(moved.draft);
          }
        } else {
          await onStageMove({
            contentId: data.contentId,
            stageName: data.stageName,
            newDateYmd: newYmd,
            allowWeekend: true,
            previousYmd: data.dateYmd,
            nextStages:
              moved?.draft?.items?.find((it) => String(it.contentId) === String(data.contentId))?.stages || [],
          });
        }
      } else {
        await runMoveForEntry(pending.entry, pending.newYmd, { forceWeekend: true });
      }
      setWeekendConfirmOpen(false);
      setPendingWeekendMove(null);
      toast.success("Stage moved");
      if (pending.source === "entry") setDetailsOpen(false);
    } catch (err) {
      toast.error(err?.message || "Failed to move stage");
    }
  }, [
    pendingWeekendMove,
    isCustomizationMode,
    customizationMinStageDateYmd,
    schedule,
    onStageMove,
    onCalendarStateChange,
    runMoveForEntry,
  ]);

  const handleQuickMoveFromChip = useCallback(
    async (entry) => {
      if (!entry || !onStageMove) return;
      const input = window.prompt("Move to date (YYYY-MM-DD)", String(entry.dateYmd || ""));
      if (input == null) return;
      try {
        const r = await runMoveForEntry(entry, input);
        if (r === "confirm_opened") return;
        toast.success("Stage moved");
      } catch (err) {
        toast.error(err?.message || "Failed to move stage");
      }
    },
    [onStageMove, runMoveForEntry]
  );

  const handleMoveToDate = useCallback(async () => {
    if (!detailsEntry) return;
    if (String(detailsEntry.stageName || "") !== "Post") {
      toast.error("Only Post stage can be moved from this popup");
      return;
    }
    const currentMonth = monthKeyFromYmd(detailsEntry.dateYmd);
    const targetMonth = monthKeyFromYmd(detailsMoveToYmd);
    const requiredPrevMonth = shiftMonthKey(currentMonth, -1);
    if (!currentMonth || !targetMonth || targetMonth !== requiredPrevMonth) {
      toast.error("Select a date in the immediate previous month");
      return;
    }
    try {
      const r = await runMoveForEntry(detailsEntry, detailsMoveToYmd);
      if (r === "confirm_opened") return;
      toast.success("Stage moved");
      setDetailsOpen(false);
    } catch (err) {
      toast.error(err?.message || "Failed to move stage");
    }
  }, [detailsEntry, detailsMoveToYmd, runMoveForEntry]);

  const postingDateByContentId = useMemo(() => {
    const map = new Map();
    for (const item of schedule?.items || []) {
      const key = String(item?.contentId || "");
      if (!key) continue;
      map.set(key, String(item?.postingDate || "").slice(0, 10));
    }
    return map;
  }, [schedule]);

  const isAfterYmd = useCallback((a, b) => {
    const da = Date.parse(`${a}T00:00:00.000Z`);
    const db = Date.parse(`${b}T00:00:00.000Z`);
    if (!Number.isFinite(da) || !Number.isFinite(db)) return false;
    return da > db;
  }, []);

  const handleDragEnd = async (event) => {
    setActiveDragId(null);
    setInvalidDropYmd("");
    setInvalidDropReason("");
    const { active, over } = event;
    if (!over) return;
    if (!canEdit || (!isCustomizationMode && !allowPostCreationEdit)) return;

    const data = active.data.current;
    if (!data || data.locked) return;

    const overId = String(over.id);
    if (!overId.startsWith("day-")) return;
    const newYmd = overId.slice(4);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newYmd)) return;
    if (newYmd === data.dateYmd) return;

    const customizationOpts =
      isCustomizationMode && customizationMinStageDateYmd
        ? {
            minStageDateYmd: String(customizationMinStageDateYmd).slice(0, 10),
            weekendEnabled: weekendMode,
          }
        : { weekendEnabled: weekendMode };

    const useWeekendConfirm = resolveUseWeekendConfirm(data.isCustomCalendar);
    const classification = classifyWeekendStageMove({
      schedule,
      contentId: data.contentId,
      stageName: data.stageName,
      newYmd,
      weekendMode,
      useWeekendConfirm,
      isCustomizationMode,
      customizationOpts,
      applyCustomizationDrag,
      applyManagerEditDrag,
    });

    if (classification.kind === "hard_block") {
      const msg = "Weekend dates are blocked";
      setDropError(msg);
      toast.error(msg);
      return;
    }
    if (classification.kind === "error") {
      const msg = classification.message || "Invalid phase move";
      setDropError(msg);
      toast.error(msg);
      return;
    }
    if (classification.kind === "confirm") {
      setPendingWeekendMove({ source: "drag", data, newYmd });
      setWeekendConfirmOpen(true);
      return;
    }

    const moved = isCustomizationMode
      ? applyCustomizationDrag(schedule, data.contentId, data.stageName, newYmd, customizationOpts)
      : applyManagerEditDrag(schedule, data.contentId, data.stageName, newYmd);
    if (moved.blocked) {
      const msg = moved.reason || "Invalid phase move";
      setDropError(msg);
      toast.error(msg);
      return;
    }
    setDropError("");

    // Pre-creation / local-only draft: no API — commit computed draft to parent.
    if (!onStageMove) {
      if (typeof onCalendarStateChange === "function" && moved?.draft) {
        onCalendarStateChange(moved.draft);
      }
      return;
    }

    try {
      await onStageMove({
        contentId: data.contentId,
        stageName: data.stageName,
        newDateYmd: newYmd,
        allowWeekend: weekendMode,
        previousYmd: data.dateYmd,
        nextStages:
          moved?.draft?.items?.find((it) => String(it.contentId) === String(data.contentId))?.stages || [],
      });
    } catch (err) {
      const reasons = err?.data?.details?.reasons;
      const message =
        Array.isArray(reasons) && reasons.length
          ? `Cannot move\n\nReason:\n- ${reasons.join("\n- ")}`
          : err?.message || "Failed to move stage";
      setDropError(message);
      toast.error(message);
    }
  };

  const handleDragStart = ({ active }) => {
    setActiveDragId(String(active.id));
    setDropError("");
    setInvalidDropYmd("");
    setValidDropYmd("");
    setInvalidDropReason("");
    setPreviewHint("");
  };

  const handleDragOver = ({ active, over }) => {
    if (!over) {
      setInvalidDropYmd("");
      setValidDropYmd("");
      setInvalidDropReason("");
      setPreviewHint("");
      return;
    }
    const overId = String(over.id || "");
    if (!overId.startsWith("day-")) {
      setInvalidDropYmd("");
      setValidDropYmd("");
      setInvalidDropReason("");
      setPreviewHint("");
      return;
    }
    const ymd = overId.slice(4);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
      setInvalidDropYmd("");
      setValidDropYmd("");
      setInvalidDropReason("");
      setPreviewHint("");
      return;
    }
    const data = active?.data?.current;
    const useWeekendConfirmHover = resolveUseWeekendConfirm(data?.isCustomCalendar);
    if (!weekendMode && isWeekendYmd(ymd) && !useWeekendConfirmHover) {
      setInvalidDropYmd(ymd);
      setValidDropYmd("");
      setInvalidDropReason("Weekend dates are blocked");
      setPreviewHint("");
      return;
    }

    const weekendPreviewUnlock =
      weekendMode || (!weekendMode && useWeekendConfirmHover && isWeekendYmd(ymd));

    const contentId = String(data?.contentId || "");
    const stageName = String(data?.stageName || "");
    const isBoundaryController = stageName === "Post" || stageName === "Plan";
    const postingYmd = postingDateByContentId.get(contentId);
    if (
      (isCustomizationMode ? !isBoundaryController : stageName !== "Post") &&
      postingYmd &&
      isAfterYmd(ymd, postingYmd)
    ) {
      setInvalidDropYmd(ymd);
      setValidDropYmd("");
      setInvalidDropReason(
        isCustomizationMode
          ? "Phase cannot reach or exceed posting date. Move Post instead."
          : "Cannot move beyond posting date"
      );
      setPreviewHint("");
      return;
    }
    const customizationOptsOver =
      isCustomizationMode && customizationMinStageDateYmd
        ? {
            minStageDateYmd: String(customizationMinStageDateYmd).slice(0, 10),
            weekendEnabled: weekendPreviewUnlock,
          }
        : { weekendEnabled: weekendPreviewUnlock };
    const candidate = isCustomizationMode
      ? applyCustomizationDrag(schedule, contentId, stageName, ymd, customizationOptsOver)
      : applyManagerEditDrag(schedule, contentId, stageName, ymd);
    if (candidate?.blocked) {
      setInvalidDropYmd(ymd);
      setValidDropYmd("");
      setInvalidDropReason(candidate.reason || "Blocked");
      setPreviewHint("");
      return;
    }

    const day = new Date(`${ymd}T00:00:00.000Z`).getUTCDay();
    const hints = [];
    if ((day === 0 || day === 6) && !weekendMode && useWeekendConfirmHover) {
      hints.push("Weekend — confirm on release");
    } else if (day === 0 || day === 6) {
      hints.push("May use weekend");
    }
    const role = String(data?.role || "").toLowerCase();
    if (
      role === "videographer" ||
      role === "videoeditor" ||
      role === "manager" ||
      role === "graphicdesigner"
    ) {
      hints.push("May extend duration");
    }

    setInvalidDropYmd("");
    setInvalidDropReason("");
    setValidDropYmd(ymd);
    setPreviewHint(hints.join(" · "));
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
        {showWeekendToggle &&
        !hideWeekendToggleForPreClient &&
        typeof onToggleWeekend === "function" ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant={weekendMode ? "default" : "outline"}
              onClick={() => onToggleWeekend(!weekendMode)}
            >
              Weekend Mode: {weekendMode ? "ON" : "OFF"}
            </Button>
          </div>
        ) : null}
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
        {showStageFilterBar ? (
          <div className="flex flex-wrap gap-1 border-l border-border pl-2">
            <span className="self-center text-[10px] font-medium text-muted-foreground">Stages</span>
            {[
              { key: "Post", label: "Post" },
              { key: "Plan", label: "Plan" },
              { key: "Shoot", label: "Shoot" },
              { key: "Edit", label: "Edit" },
              { key: "Design", label: "Design" },
              { key: "Approval", label: "Approval" },
              { key: "all", label: "All stages" },
            ].map(({ key, label }) => (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={stageFilter === key ? "default" : "outline"}
                onClick={() => setStageFilter(key)}
              >
                {label}
              </Button>
            ))}
          </div>
        ) : null}
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
        <Badge variant="outline" className="border-orange-500/40 font-normal">
          <span className="mr-1 h-2 w-2 rounded-full bg-orange-500" aria-hidden />
          Busy
        </Badge>
        <Badge variant="outline" className="border-red-600/60 font-normal">
          <span className="mr-1 h-2 w-2 rounded-full bg-red-500" aria-hidden />
          Overloaded
        </Badge>
        <Badge variant="outline" className="border-blue-600/60 font-normal">
          <span className="mr-1 h-2 w-2 rounded-full bg-blue-600" aria-hidden />
          Capacity warning
        </Badge>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragCancel={() => {
          setActiveDragId(null);
          setInvalidDropYmd("");
          setValidDropYmd("");
          setInvalidDropReason("");
          setPreviewHint("");
        }}
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
              const overloadedByWarnings = dayWarnings.some(
                (w) => Number(w?.effectiveCount) > Number(w?.capacity)
              );
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
                  warningSeverity={overloadedByWarnings ? "overloaded" : dayWarnings.length ? "warning" : "none"}
                  invalidDrop={ymd === invalidDropYmd}
                  invalidReason={ymd === invalidDropYmd ? invalidDropReason : ""}
                  validDrop={ymd === validDropYmd}
                  previewHint={ymd === validDropYmd ? previewHint : ""}
                >
                  {list.map((entry) => (
                    <StageChip
                      key={entry.id}
                      entry={entry}
                      filterType={filterType}
                      stageFilter={stageFilter}
                      saving={saving}
                      canEdit={canEdit}
                      isCustomizationMode={isCustomizationMode}
                      lockPostStage={lockPostStage}
                      onOpenDetails={openDetails}
                      onQuickMove={handleQuickMoveFromChip}
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
      {dropError ? <p className="text-sm text-destructive">{dropError}</p> : null}

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
                <span className="text-muted-foreground">Client</span>
                <span className="font-medium">{detailsItem?.clientName || detailsItem?.title || "-"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Role</span>
                <span className="font-medium">{detailsEntry.role || "-"}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Due date</span>
                <span className="font-medium">{detailsEntry.dateYmd}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Duration</span>
                <span className="font-medium">1 day</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Assigned to</span>
                <span className="font-medium">
                  {resolveUserName(
                    detailsItem?.stages?.find((s) => s?.name === detailsEntry.stageName)?.assignedUser
                  )}
                </span>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-xs font-semibold text-muted-foreground">Assigned users per day</p>
                <p className="mt-1 text-xs">
                  {detailsEntry.dateYmd}: {resolveUserName(detailStage?.assignedUser)}
                </p>
              </div>
              <div className="rounded-md border p-2">
                <p className="text-xs font-semibold text-muted-foreground">Conflicts</p>
                {detailWarnings.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">No conflicts</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-xs">
                    {detailWarnings.map((w, i) => (
                      <li key={`${w.role}-${i}`} className="text-destructive">
                        {w.message || "Capacity/conflict warning"}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-md border p-2">
                <p className="text-xs font-semibold text-muted-foreground">Suggestions</p>
                {detailSuggestions.length === 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">No suggestions</p>
                ) : (
                  <ul className="mt-1 space-y-1 text-xs">
                    {detailSuggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                )}
              </div>
              {detailsItem?.postingDate ? (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Posting date</span>
                  <span className="font-medium">{String(detailsItem.postingDate).slice(0, 10)}</span>
                </div>
              ) : null}
              {String(detailsEntry?.stageName || "") === "Post" ? (
                <div className="grid gap-2 rounded-md border p-2">
                  <p className="text-xs font-semibold text-muted-foreground">Move stage to date</p>
                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      value={detailsMoveToYmd}
                      onChange={(e) => setDetailsMoveToYmd(e.target.value)}
                      className="h-8"
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={handleMoveToDate}
                      disabled={!detailsEntry || saving || !detailsMoveToYmd}
                    >
                      Move
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Only previous-month dates are allowed for Post moves.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={weekendConfirmOpen}
        onOpenChange={(open) => {
          setWeekendConfirmOpen(open);
          if (!open) setPendingWeekendMove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move to weekend?</AlertDialogTitle>
            <AlertDialogDescription>
              You are moving this task to a weekend. Do you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setWeekendConfirmOpen(false);
                setPendingWeekendMove(null);
              }}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void confirmWeekendMove()}>
              Continue
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
