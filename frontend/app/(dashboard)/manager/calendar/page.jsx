"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  MoreHorizontal,
  GripVertical,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

function weekdayShortUTC(ymd) {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(d);
}

function addDaysToYMD(ymd, days) {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  d.setUTCDate(d.getUTCDate() + days);
  return toYMDUTC(d);
}

const roleLabel = {
  strategist: "Strategist",
  videographer: "Videographer",
  videoEditor: "Video Editor",
  manager: "Manager",
  graphicDesigner: "Graphic Designer",
  postingExecutive: "Posting Executive",
};

const roleOrder = [
  "strategist",
  "videographer",
  "videoEditor",
  "graphicDesigner",
  "manager",
  "postingExecutive",
];

function normalizeRoleKey(value) {
  const v = String(value || "").toLowerCase();
  if (v.includes("strateg")) return "strategist";
  if (v.includes("videographer")) return "videographer";
  if (v.includes("videoeditor") || v.includes("video editor") || v === "editor") return "videoEditor";
  if (v.includes("graphic")) return "graphicDesigner";
  if (v.includes("posting")) return "postingExecutive";
  if (v.includes("manager")) return "manager";
  return String(value || "");
}

/** Human label for ContentItem.contentType on calendar blocks (reel / post / carousel / …). */
function contentTypeLabel(raw) {
  const t = String(raw || "").toLowerCase();
  if (t === "reel") return "Reel";
  if (t === "static_post" || t === "post") return "Post";
  if (t === "carousel") return "Carousel";
  if (t === "gmb_post") return "GMB";
  if (t === "campaign") return "Campaign";
  if (!t) return "—";
  return String(raw).replace(/_/g, " ");
}

function contentTypeChipClassName(raw) {
  const t = String(raw || "").toLowerCase();
  if (t === "reel") return "border-sky-500/55 bg-sky-500/15 text-sky-950 dark:text-sky-100";
  if (t === "static_post" || t === "post") return "border-violet-500/55 bg-violet-500/15 text-violet-950 dark:text-violet-100";
  if (t === "carousel") return "border-amber-500/55 bg-amber-500/15 text-amber-950 dark:text-amber-100";
  if (t === "gmb_post") return "border-emerald-500/55 bg-emerald-500/15 text-emerald-950 dark:text-emerald-100";
  return "border-border bg-background/85 text-foreground";
}

/** Maps API contentType to filter bucket (reel / static_post / carousel). */
function normalizeContentTypeFilterKey(raw) {
  const t = String(raw || "").toLowerCase();
  if (t === "reel") return "reel";
  if (t === "static_post" || t === "post" || t === "gmb_post" || t === "campaign") return "static_post";
  if (t === "carousel") return "carousel";
  return "other";
}

const CONTENT_FILTER_OPTIONS = [
  { key: "reel", label: "Reel" },
  { key: "static_post", label: "Static post" },
  { key: "carousel", label: "Carousel" },
];

const CLIENT_COLOR_PALETTE = [
  { bg: "rgba(59,130,246,0.10)", border: "rgba(59,130,246,0.55)" },
  { bg: "rgba(16,185,129,0.10)", border: "rgba(16,185,129,0.55)" },
  { bg: "rgba(244,114,182,0.10)", border: "rgba(244,114,182,0.55)" },
  { bg: "rgba(250,204,21,0.10)", border: "rgba(234,179,8,0.60)" },
  { bg: "rgba(168,85,247,0.10)", border: "rgba(168,85,247,0.55)" },
  { bg: "rgba(34,211,238,0.10)", border: "rgba(34,211,238,0.55)" },
  { bg: "rgba(251,146,60,0.10)", border: "rgba(249,115,22,0.55)" },
  { bg: "rgba(129,140,248,0.10)", border: "rgba(129,140,248,0.55)" },
];

function hashClientKey(input) {
  const s = String(input || "");
  let h = 0;
  for (let i = 0; i < s.length; i += 1) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export function GlobalCalendarPage({ actor = "manager" }) {
  const isStrategist = actor === "strategist";
  const DEFAULT_ROLE_CAPACITY = 5;
  const todayYmd = useMemo(() => toYMDUTC(new Date()), []);
  const [month, setMonth] = useState(() => toMonthStringUTC(new Date()));
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [leaveEntries, setLeaveEntries] = useState([]);
  const [leaveBlocks, setLeaveBlocks] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [capacityByRole, setCapacityByRole] = useState({});
  const [assignedClientIds, setAssignedClientIds] = useState([]);
  const [weekendMode, setWeekendMode] = useState(true);
  const [draggingTaskId, setDraggingTaskId] = useState("");
  const [hoveredDropCell, setHoveredDropCell] = useState("");
  const [dragBusy, setDragBusy] = useState(false);
  const [dropError, setDropError] = useState("");
  const [leaveForm, setLeaveForm] = useState({
    userId: "",
    startDate: "",
    endDate: "",
    reason: "",
  });
  const [editingLeaveId, setEditingLeaveId] = useState("");
  const [leaveBusy, setLeaveBusy] = useState(false);
  const [leaveFormError, setLeaveFormError] = useState("");
  const [selectedTask, setSelectedTask] = useState(null);
  /** When a cell has multiple tasks, user opens this to see full list (no in-cell scroll). */
  const [cellOverflow, setCellOverflow] = useState(null);
  const [selectedOverflowTaskIds, setSelectedOverflowTaskIds] = useState([]);
  const [bulkMoveTargetUserId, setBulkMoveTargetUserId] = useState("");
  const [bulkMoveBusy, setBulkMoveBusy] = useState(false);
  const [contentTypeFilters, setContentTypeFilters] = useState({
    reel: true,
    static_post: true,
    carousel: true,
  });
  const gridScrollRef = useRef(null);
  const leaveSectionRef = useRef(null);
  const overflowCarouselRef = useRef(null);
  const autoScrolledMonthRef = useRef("");
  const panRef = useRef({ active: false, startX: 0, startY: 0, scrollLeft: 0, scrollTop: 0 });
  const lastDragEndRef = useRef({ taskId: "", at: 0 });
  const [isPanningGrid, setIsPanningGrid] = useState(false);
  const [overflowSlideIndex, setOverflowSlideIndex] = useState(0);
  const [highlightedCell, setHighlightedCell] = useState("");
  const [highlightLeaveSection, setHighlightLeaveSection] = useState(false);
  const pendingLeaveConflictRef = useRef(null);
  const pendingLeaveSuccessRef = useRef(null);

  const handleGridMouseDown = (e) => {
    // Left mouse pans only when starting from non-interactive background.
    if (e.button !== 0) return;
    const rawTarget = e.target;
    const targetEl =
      rawTarget instanceof Element
        ? rawTarget
        : rawTarget && rawTarget.parentElement instanceof Element
          ? rawTarget.parentElement
          : null;
    if (targetEl) {
      const interactive = targetEl.closest(
        'button, input, select, textarea, a, [draggable="true"], [data-task-card="true"]'
      );
      if (interactive) return;
    }
    const el = gridScrollRef.current;
    if (!el) return;
    panRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
    setIsPanningGrid(true);
    e.preventDefault();
  };

  useEffect(() => {
    if (!isPanningGrid) return undefined;

    const onMouseMove = (e) => {
      const el = gridScrollRef.current;
      const pan = panRef.current;
      if (!el || !pan.active) return;
      el.scrollLeft = pan.scrollLeft - (e.clientX - pan.startX);
      el.scrollTop = pan.scrollTop - (e.clientY - pan.startY);
    };

    const stopPan = () => {
      panRef.current.active = false;
      setIsPanningGrid(false);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stopPan);

    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stopPan);
    };
  }, [isPanningGrid]);

  useEffect(() => {
    setOverflowSlideIndex(0);
    const el = overflowCarouselRef.current;
    if (el) el.scrollTo({ left: 0, behavior: "auto" });
    const visibleTasks = (cellOverflow?.tasks || []).filter((t) => canEditTask(t));
    setSelectedOverflowTaskIds(
      visibleTasks.map((t, idx) => String(t?.taskId || `${String(t?.contentItemId || "")}-${idx}`))
    );
    setBulkMoveTargetUserId("");
  }, [cellOverflow]);

  const overflowContentTypeCounts = useMemo(() => {
    const counts = { reel: 0, static_post: 0, carousel: 0 };
    for (const task of cellOverflow?.tasks || []) {
      const bucket = normalizeContentTypeFilterKey(task?.contentType);
      if (bucket === "reel" || bucket === "static_post" || bucket === "carousel") {
        counts[bucket] += 1;
      }
    }
    return counts;
  }, [cellOverflow]);

  const scrollOverflowCarousel = (direction) => {
    const el = overflowCarouselRef.current;
    if (!el) return;
    const step = Math.max(260, Math.round(el.clientWidth * 0.88));
    const nextLeft = direction === "next" ? el.scrollLeft + step : el.scrollLeft - step;
    el.scrollTo({ left: nextLeft, behavior: "smooth" });
  };

  const handleOverflowCarouselScroll = () => {
    const el = overflowCarouselRef.current;
    if (!el) return;
    const step = Math.max(260, Math.round(el.clientWidth * 0.88));
    const idx = Math.max(0, Math.round(el.scrollLeft / step));
    setOverflowSlideIndex(idx);
  };

  const scrollToLeaveSection = (opts = {}) => {
    if (opts?.highlight === true) {
      setHighlightLeaveSection(true);
    }
    requestAnimationFrame(() => {
      const el = leaveSectionRef.current;
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const scrollToConflictCell = (userId, ymd) => {
    requestAnimationFrame(() => {
      const day = String(ymd || "").slice(0, 10);
      if (!day) return;
      const key = `${String(userId || "")}::${day}`;
      setHighlightedCell(key);
      const cells = Array.from(document.querySelectorAll(`[data-gc-ymd="${day}"]`));
      if (!cells.length) return;
      const target =
        cells.find((el) => String(el.getAttribute("data-gc-user") || "") === String(userId || "")) ||
        cells[0];
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    });
  };

  useEffect(() => {
    if (!highlightedCell) return undefined;
    const t = setTimeout(() => setHighlightedCell(""), 60000);
    return () => clearTimeout(t);
  }, [highlightedCell]);

  useEffect(() => {
    if (!highlightLeaveSection) return undefined;
    const t = setTimeout(() => setHighlightLeaveSection(false), 60000);
    return () => clearTimeout(t);
  }, [highlightLeaveSection]);

  const loadCalendar = async (options = {}) => {
    const silent = options?.silent === true;
    const preserveScroll = options?.preserveScroll === true;
    const scroller = gridScrollRef.current;
    const prevScroll = preserveScroll && scroller
      ? { left: scroller.scrollLeft, top: scroller.scrollTop }
      : null;
    try {
      if (!silent) setLoading(true);
      // Single global source for calendar; strategist has restricted edit permissions.
      const [calendarRes, teamUsersRes, leaveRes, holidayRes] = await Promise.all([
        isStrategist ? api.getStrategistGlobalCalendar(month) : api.getManagerGlobalCalendar(month),
        isStrategist ? api.getStrategistTeamUsers() : api.getTeamUsers(),
        isStrategist ? api.getStrategistLeave() : api.getManagerLeave(),
        api.getHoliday(),
      ]);
      const capRes = await (isStrategist
        ? api.getStrategistTeamCapacity()
        : api.getManagerTeamCapacity()
      ).catch(() => ({ data: [] }));
      const data = calendarRes?.data || calendarRes || {};
      setTasks(data?.updatedTasks || data?.tasks || []);
      setAssignedClientIds(Array.isArray(data?.assignedClientIds) ? data.assignedClientIds : []);
      setUsers(teamUsersRes?.data || []);
      setLeaveEntries(leaveRes?.data || leaveRes || []);
      setLeaveBlocks(data?.leaveBlocks || []);
      setHolidays(holidayRes?.data || holidayRes || []);
      const capRows = capRes?.data || [];
      const capMap = {};
      const parseCapacity = (value, fallback = DEFAULT_ROLE_CAPACITY) => {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) return n;
        return fallback;
      };
      for (const row of capRows) {
        const role = normalizeRoleKey(row?.role);
        if (!role) continue;
        const dailyFallback = parseCapacity(row?.dailyCapacity, DEFAULT_ROLE_CAPACITY);
        capMap[role] = {
          reel: parseCapacity(row?.reelCapacity, dailyFallback),
          static_post: parseCapacity(row?.postCapacity, dailyFallback),
          carousel: parseCapacity(row?.carouselCapacity, dailyFallback),
        };
      }
      setCapacityByRole(capMap);
      if (prevScroll) {
        requestAnimationFrame(() => {
          const el = gridScrollRef.current;
          if (!el) return;
          el.scrollLeft = prevScroll.left;
          el.scrollTop = prevScroll.top;
        });
      }
    } catch (error) {
      toast.error(error.message || "Failed to load calendar");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadCalendar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, isStrategist]);

  useEffect(() => {
    const pendingSuccess = pendingLeaveSuccessRef.current;
    if (pendingSuccess) {
      const successMonth = String(pendingSuccess?.date || "").slice(0, 7);
      if (successMonth && successMonth === month) {
        scrollToConflictCell(pendingSuccess.userId, pendingSuccess.date);
        pendingLeaveSuccessRef.current = null;
      }
    }
    const pending = pendingLeaveConflictRef.current;
    if (!pending) return;
    const conflictMonth = String(pending?.date || "").slice(0, 7);
    if (!conflictMonth || conflictMonth !== month) return;
    scrollToConflictCell(pending.userId, pending.date);
    pendingLeaveConflictRef.current = null;
  }, [month, tasks]);

  const userMetaById = useMemo(() => {
    const map = new Map();
    (users || []).forEach((u) => {
      const id = String(u?._id || "");
      if (!id) return;
      map.set(id, {
        id,
        name: u?.name || `User ${id.slice(-4)}`,
        role: normalizeRoleKey(u?.role?.name || u?.role?.slug || u?.role),
      });
    });
    return map;
  }, [users]);

  const bulkMoveTargetUsers = useMemo(() => {
    if (!cellOverflow?.row?.role) return [];
    const role = String(cellOverflow.row.role || "");
    const currentUserId = String(cellOverflow.row.userId || "");
    return (users || [])
      .filter((u) => normalizeRoleKey(u?.role?.name || u?.role?.slug || u?.role || "") === role)
      .filter((u) => String(u?._id || "") !== currentUserId);
  }, [cellOverflow, users]);

  const calendarDays = useMemo(() => {
    const m = String(month).match(/^(\d{4})-(\d{2})$/);
    if (!m) return [];
    const year = Number(m[1]);
    const monthIndex = Number(m[2]) - 1;
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const out = [];
    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      out.push({ dayNum, ymd: toYMDUTC(new Date(Date.UTC(year, monthIndex, dayNum))) });
    }
    return out;
  }, [month]);

  const isCurrentMonthView = useMemo(
    () => month === String(todayYmd || "").slice(0, 7),
    [month, todayYmd]
  );

  useEffect(() => {
    if (!isCurrentMonthView || loading) return;
    const scroller = gridScrollRef.current;
    if (!scroller) return;
    if (autoScrolledMonthRef.current === month) return;
    const todayIndex = (calendarDays || []).findIndex((d) => d?.ymd === todayYmd);
    if (todayIndex < 0) return;
    const dayCell = scroller.querySelector("[data-gc-col-day]");
    if (!dayCell) return;
    const colWidth = dayCell.getBoundingClientRect().width || 120;
    const targetLeft = Math.max(0, (todayIndex + 1) * colWidth - scroller.clientWidth * 0.45);
    scroller.scrollTo({ left: targetLeft, behavior: "smooth" });
    autoScrolledMonthRef.current = month;
  }, [calendarDays, isCurrentMonthView, loading, month, todayYmd]);

  const filteredTasks = useMemo(() => {
    const list = tasks || [];
    const { reel, static_post, carousel } = contentTypeFilters;
    if (!reel && !static_post && !carousel) return [];
    if (reel && static_post && carousel) return list;
    return list.filter((task) => {
      const k = normalizeContentTypeFilterKey(task.contentType);
      if (k === "other") return false;
      return Boolean(contentTypeFilters[k]);
    });
  }, [tasks, contentTypeFilters]);

  const groupedRows = useMemo(() => {
    const rowMap = new Map(); // role::userId => row
    const seenCellTask = new Set(); // role::userId::day::taskId

    const ensureRow = (role, userId, fallbackName = "") => {
      const normalizedRole = normalizeRoleKey(role || "unknown");
      const id = String(userId || "unassigned");
      const key = `${normalizedRole}::${id}`;
      if (!rowMap.has(key)) {
        const meta = userMetaById.get(id);
        rowMap.set(key, {
          role: normalizedRole,
          userId: id,
          name: meta?.name || fallbackName || (id === "unassigned" ? "Unassigned" : `User ${id.slice(-4)}`),
          byDay: new Map(),
        });
      }
      return rowMap.get(key);
    };

    // Base rows from users (resource-based).
    for (const user of users || []) {
      const id = String(user?._id || "");
      if (!id) continue;
      const role = normalizeRoleKey(user?.role?.name || user?.role?.slug || user?.role || "unknown");
      ensureRow(role, id, user?.name || "");
    }

    // Fill per-day cells from assignedUsersPerDay (source of truth for rendered allocation).
    for (const task of filteredTasks || []) {
      const taskRole = normalizeRoleKey(task?.role || "unknown");
      const perDay = task?.assignedUsersPerDay && typeof task.assignedUsersPerDay === "object"
        ? task.assignedUsersPerDay
        : {};
      const fallbackTaskId = `${taskRole}-${String(task?.contentItemId || "")}-${String(task?.stageName || "")}-${String(
        task?.startDate || task?.date || ""
      )}`;
      const taskIdKey = String(task?.taskId || fallbackTaskId);
      for (const [day, dayUser] of Object.entries(perDay)) {
        const userId = String(dayUser || "unassigned");
        const row = ensureRow(taskRole, userId);
        const dedupeKey = `${taskRole}::${userId}::${day}::${taskIdKey}`;
        if (seenCellTask.has(dedupeKey)) continue;
        seenCellTask.add(dedupeKey);
        row.byDay.set(day, [...(row.byDay.get(day) || []), task]);
      }
    }

    const roleGroups = new Map();
    for (const row of rowMap.values()) {
      if (!roleGroups.has(row.role)) roleGroups.set(row.role, []);
      roleGroups.get(row.role).push(row);
    }

    const sortedRoles = [...roleGroups.keys()].sort((a, b) => {
      const ai = roleOrder.indexOf(a);
      const bi = roleOrder.indexOf(b);
      if (ai === -1 && bi === -1) return String(a).localeCompare(String(b));
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    return sortedRoles.map((role) => ({
      role,
      rows: (roleGroups.get(role) || []).sort((a, b) => String(a.name).localeCompare(String(b.name))),
    }));
  }, [filteredTasks, users, userMetaById]);

  const normalizedLeaves = useMemo(() => {
    const source = [
      ...(Array.isArray(leaveEntries) ? leaveEntries : []),
      ...(Array.isArray(leaveBlocks) ? leaveBlocks : []),
    ];
    return source
      .map((leave) => {
        const uidRaw = leave?.userId;
        const userId =
          uidRaw && typeof uidRaw === "object"
            ? String(uidRaw?._id || uidRaw?.id || "")
            : String(uidRaw || "");
        const startDate = String(leave?.startDate || leave?.from || "").slice(0, 10);
        const endDate = String(leave?.endDate || leave?.to || "").slice(0, 10);
        if (!userId || !startDate || !endDate) return null;
        return { userId, startDate, endDate };
      })
      .filter(Boolean);
  }, [leaveEntries, leaveBlocks]);

  const leaveByUserDay = useMemo(() => {
    const map = new Set();
    for (const leave of normalizedLeaves || []) {
      const userId = String(leave?.userId || "");
      const start = String(leave?.startDate || "");
      const end = String(leave?.endDate || "");
      if (!userId || !start || !end) continue;
      let cur = start;
      while (cur <= end) {
        map.add(`${userId}::${cur}`);
        cur = addDaysToYMD(cur, 1);
      }
    }
    return map;
  }, [normalizedLeaves]);

  const holidayByDay = useMemo(() => {
    const map = new Map();
    for (const h of holidays || []) {
      const rawDate = h?.date || h?.day || h?.holidayDate;
      const ymd = String(rawDate || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
      map.set(ymd, h?.name || h?.title || "Holiday");
    }
    return map;
  }, [holidays]);

  const managerLeaves = useMemo(() => {
    return (leaveEntries || [])
      .map((leave) => {
        const uidRaw = leave?.userId;
        const userId =
          uidRaw && typeof uidRaw === "object"
            ? String(uidRaw?._id || uidRaw?.id || "")
            : String(uidRaw || "");
        const leaveId = String(leave?.leaveId || leave?._id || "");
        const startDate = String(leave?.startDate || leave?.from || "").slice(0, 10);
        const endDate = String(leave?.endDate || leave?.to || "").slice(0, 10);
        return {
          leaveId,
          userId,
          startDate,
          endDate,
          reason: String(leave?.reason || ""),
        };
      })
      .filter((x) => x.userId && x.startDate && x.endDate)
      .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  }, [leaveEntries]);

  const usedByUserDayType = useMemo(() => {
    const map = new Map();
    const seen = new Set(); // user::day::bucket::taskId
    // Capacity state must reflect all scheduled tasks for the month,
    // not just currently visible filtered cards.
    for (const task of tasks || []) {
      const perDay = task?.assignedUsersPerDay && typeof task.assignedUsersPerDay === "object"
        ? task.assignedUsersPerDay
        : {};
      const bucket = normalizeContentTypeFilterKey(task?.contentType);
      if (bucket === "other") continue;
      const fallbackTaskId = `${String(task?.contentItemId || "")}-${String(task?.stageName || "")}-${String(
        task?.startDate || task?.date || ""
      )}`;
      const taskIdKey = String(task?.taskId || fallbackTaskId);
      for (const [day, dayUser] of Object.entries(perDay)) {
        const userId = String(dayUser || "unassigned");
        const dedupeKey = `${userId}::${day}::${bucket}::${taskIdKey}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        const key = `${userId}::${day}::${bucket}`;
        map.set(key, (map.get(key) || 0) + 1);
      }
    }
    return map;
  }, [tasks]);

  const getRoleBucketCapacity = (role, bucket) => {
    const byRole = capacityByRole?.[role];
    const val = Number(byRole?.[bucket]);
    return Number.isFinite(val) && val >= 0 ? val : DEFAULT_ROLE_CAPACITY;
  };

  const hasAnyOverloaded = useMemo(() => {
    for (const [key, used] of usedByUserDayType.entries()) {
      const parts = String(key || "").split("::");
      const userId = parts[0] || "";
      const bucket = parts[2] || "";
      if (!userId || !bucket) continue;
      const role = userMetaById.get(userId)?.role || "";
      const cap = getRoleBucketCapacity(role, bucket);
      if (Number(used) > Number(cap)) return true;
    }
    return false;
  }, [usedByUserDayType, userMetaById, capacityByRole]);

  const taskById = useMemo(() => {
    const map = new Map();
    for (const t of tasks || []) {
      if (!t?.taskId) continue;
      map.set(String(t.taskId), t);
    }
    return map;
  }, [tasks]);

  const selectedTaskDetails = useMemo(() => {
    if (!selectedTask?.task) return null;
    const task = selectedTask.task;
    const perDay = task?.assignedUsersPerDay && typeof task.assignedUsersPerDay === "object"
      ? task.assignedUsersPerDay
      : {};
    const assignments = Object.entries(perDay)
      .sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([day, uid]) => ({
        day,
        userId: String(uid || ""),
        userName: userMetaById.get(String(uid || ""))?.name || String(uid || "Unassigned"),
      }));
    return { task, assignments };
  }, [selectedTask, userMetaById]);

  const clientColorByKey = useMemo(() => {
    const map = new Map();
    for (const t of tasks || []) {
      const key = String(t?.clientId || t?.clientName || "");
      if (!key || map.has(key)) continue;
      const idx = hashClientKey(key) % CLIENT_COLOR_PALETTE.length;
      map.set(key, CLIENT_COLOR_PALETTE[idx]);
    }
    return map;
  }, [tasks]);

  const isWeekendYmd = (ymd) => {
    const d = new Date(`${ymd}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime())) return false;
    const day = d.getUTCDay();
    return day === 0 || day === 6;
  };

  const isBeforeTodayYmd = (ymd) => String(ymd || "") < String(todayYmd || "");

  const canDropOnCell = (_row, ymd) => {
    // Manager global calendar should not hard-block leave/holiday/capacity in UI.
    // Backend managerDragTask is the authority (borrowing/replacement/simulation).
    if (isBeforeTodayYmd(ymd)) return false;
    const weekendBlocked = !weekendMode && isWeekendYmd(ymd);
    return !weekendBlocked;
  };

  const canEditTask = (task) => {
    if (!isStrategist) return true;
    const cid = String(task?.clientId || "");
    return assignedClientIds.includes(cid);
  };

  const handleDrop = async (e, row, ymd) => {
    if (dragBusy) return;
    const taskIdFromDrop = String(e?.dataTransfer?.getData("taskId") || "");
    const itemIdFromDrop = String(e?.dataTransfer?.getData("itemId") || "");
    const stageIdFromDrop = String(e?.dataTransfer?.getData("stageId") || "");
    const task =
      taskById.get(taskIdFromDrop) ||
      taskById.get(String(draggingTaskId)) ||
      (tasks || []).find(
        (t) =>
          String(t?.contentItemId || "") === itemIdFromDrop &&
          String(t?.stageId || "") === stageIdFromDrop
      );
    if (!task) return;
    if (!canEditTask(task)) {
      const msg = "Access denied: You can only modify tasks of assigned clients";
      setDropError(msg);
      toast.error(msg);
      return;
    }
    if (!canDropOnCell(row, ymd)) {
      const msg = isBeforeTodayYmd(ymd)
        ? "Cannot move: date is before today"
        : "Cannot move: weekend blocked (Weekend is OFF)";
      setDropError(msg);
      toast.error(msg);
      return;
    }
    const perDay =
      task?.assignedUsersPerDay && typeof task.assignedUsersPerDay === "object"
        ? task.assignedUsersPerDay
        : {};
    const currentDays = Object.keys(perDay);
    const sameRoleAsRow =
      normalizeRoleKey(task.role) === row.role && row.userId && row.userId !== "unassigned";

    // Multi-day stages list every calendar day in `assignedUsersPerDay`. Blocking any matching
    // `ymd` prevented reassigning that day to another user on the same role row (e.g. Shoot A → B).
    if (currentDays.includes(ymd)) {
      const assigneeForDay =
        perDay[ymd] != null && perDay[ymd] !== "" ? String(perDay[ymd]) : "";
      if (!sameRoleAsRow) {
        const msg = "No change: task already assigned on this date";
        setDropError(msg);
        toast.error(msg);
        return;
      }
      if (assigneeForDay && String(row.userId) === assigneeForDay) {
        const msg = "No change: task already assigned on this date";
        setDropError(msg);
        toast.error(msg);
        return;
      }
    }

    try {
      setDragBusy(true);
      setDropError("");
      if (!task.contentItemId || !task.stageName) {
        throw new Error("Task metadata missing for drag operation");
      }
      await (isStrategist ? api.strategistDragTask : api.managerDragTask)({
        contentId: task.contentItemId,
        stageName: task.stageName,
        newDate: ymd,
        allowWeekend: weekendMode === true,
        fromGlobalCalendar: true,
        targetUserId: row.userId && row.userId !== "unassigned" ? row.userId : undefined,
      });
      // Backend is source of truth: replace entire calendar state from API.
      await loadCalendar({ silent: true, preserveScroll: true });
      toast.success("Schedule updated");
    } catch (err) {
      const reasons = err?.data?.details?.reasons;
      const msg =
        Array.isArray(reasons) && reasons.length
          ? `Cannot move\n- ${reasons.join("\n- ")}`
          : err?.message || "Drag failed";
      setDropError(msg);
      toast.error(msg);
    } finally {
      setDragBusy(false);
      setDraggingTaskId("");
      setHoveredDropCell("");
    }
  };

  const resetLeaveForm = () => {
    setLeaveForm({ userId: "", startDate: "", endDate: "", reason: "" });
    setEditingLeaveId("");
    setLeaveFormError("");
  };

  const handleSaveLeave = async () => {
    const userId = String(leaveForm.userId || "").trim();
    const startDate = String(leaveForm.startDate || "").trim();
    const endDate = String(leaveForm.endDate || "").trim();
    const reason = String(leaveForm.reason || "").trim();
    if (!userId || !startDate || !endDate) {
      setLeaveFormError("User, start date, and end date are required");
      return;
    }
    if (startDate > endDate) {
      setLeaveFormError("startDate cannot be after endDate");
      return;
    }
    try {
      setLeaveBusy(true);
      setLeaveFormError("");
      const successUserId = userId;
      const successStartDate = startDate;
      // Update = delete + create (current API set has no PATCH leave endpoint).
      if (editingLeaveId) {
        await api.deleteManagerLeave(editingLeaveId);
      }
      await api.addManagerLeave({ userId, startDate, endDate, reason });
      toast.success(editingLeaveId ? "Leave updated" : "Leave added");
      resetLeaveForm();
      await loadCalendar({ silent: true });
      scrollToLeaveSection({ highlight: true });
      const successMonth = String(successStartDate || "").slice(0, 7);
      pendingLeaveSuccessRef.current = {
        userId: String(successUserId || ""),
        date: String(successStartDate || "").slice(0, 10),
      };
      if (successMonth && successMonth !== month) {
        setMonth(successMonth);
      } else {
        scrollToConflictCell(String(successUserId || ""), String(successStartDate || "").slice(0, 10));
        pendingLeaveSuccessRef.current = null;
      }
    } catch (err) {
      const msg = err?.data?.reason || err?.message || "Failed to save leave";
      setLeaveFormError(msg);
      toast.error(msg);
      const conflict = err?.data?.details?.conflict;
      if (conflict?.date) {
        const conflictDate = String(conflict.date).slice(0, 10);
        const conflictMonth = conflictDate.slice(0, 7);
        pendingLeaveConflictRef.current = {
          userId: String(conflict.userId || userId || ""),
          date: conflictDate,
        };
        scrollToLeaveSection();
        if (conflictMonth && conflictMonth !== month) {
          setMonth(conflictMonth);
        } else {
          scrollToConflictCell(String(conflict.userId || userId || ""), conflictDate);
          pendingLeaveConflictRef.current = null;
        }
      }
    } finally {
      setLeaveBusy(false);
    }
  };

  const handleEditLeave = (leave) => {
    setEditingLeaveId(String(leave.leaveId || ""));
    setLeaveForm({
      userId: String(leave.userId || ""),
      startDate: String(leave.startDate || "").slice(0, 10),
      endDate: String(leave.endDate || "").slice(0, 10),
      reason: String(leave.reason || ""),
    });
    setLeaveFormError("");
  };

  const handleDeleteLeave = async (leaveId) => {
    if (!leaveId) return;
    try {
      setLeaveBusy(true);
      await api.deleteManagerLeave(leaveId);
      toast.success("Leave deleted");
      if (String(editingLeaveId) === String(leaveId)) resetLeaveForm();
      await loadCalendar();
    } catch (err) {
      const msg = err?.message || "Failed to delete leave";
      toast.error(msg);
    } finally {
      setLeaveBusy(false);
    }
  };

  const handleBulkMoveSelected = async () => {
    if (!cellOverflow?.tasks?.length) return;
    if (!bulkMoveTargetUserId) {
      toast.error("Select a target user");
      return;
    }
    const selectedSet = new Set((selectedOverflowTaskIds || []).map(String));
    const selectedTasks = (cellOverflow.tasks || []).filter((task, idx) => {
      const fallbackId = `${String(task?.contentItemId || "")}-${idx}`;
      const id = String(task?.taskId || fallbackId);
      return selectedSet.has(id) && canEditTask(task);
    });
    if (!selectedTasks.length) {
      toast.error("Select at least one task to move");
      return;
    }

    try {
      setBulkMoveBusy(true);
      let moved = 0;
      const failed = [];
      for (const task of selectedTasks) {
        try {
          await (isStrategist ? api.strategistDragTask : api.managerDragTask)({
            contentId: task.contentItemId,
            stageName: task.stageName,
            newDate: cellOverflow.dayYmd,
            allowWeekend: weekendMode === true,
            fromGlobalCalendar: true,
            targetUserId: bulkMoveTargetUserId,
          });
          moved += 1;
        } catch (err) {
          failed.push(task?.title || task?.contentItemId || "Task");
        }
      }
      await loadCalendar({ silent: true, preserveScroll: true });
      if (moved > 0) {
        toast.success(`Moved ${moved} task${moved === 1 ? "" : "s"}`);
      }
      if (failed.length > 0) {
        toast.error(`Failed to move ${failed.length} task${failed.length === 1 ? "" : "s"}`);
      }
      if (moved > 0 && failed.length === 0) {
        setCellOverflow(null);
      }
    } finally {
      setBulkMoveBusy(false);
    }
  };

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Global Calendar</h2>
          <p className="text-sm text-muted-foreground">Single global view across all clients, grouped by role then user.</p>
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
          <Button
            variant={weekendMode ? "default" : "outline"}
            size="sm"
            onClick={() => setWeekendMode((v) => !v)}
          >
            Weekend: {weekendMode ? "ON" : "OFF"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">Content type</span>
        {CONTENT_FILTER_OPTIONS.map(({ key, label }) => {
          const on = contentTypeFilters[key];
          const chip =
            key === "reel"
              ? "border-sky-500/60 bg-sky-500/15 text-sky-950 dark:text-sky-100"
              : key === "static_post"
                ? "border-violet-500/60 bg-violet-500/15 text-violet-950 dark:text-violet-100"
                : "border-amber-500/60 bg-amber-500/15 text-amber-950 dark:text-amber-100";
          return (
            <Button
              key={key}
              type="button"
              size="sm"
              variant="outline"
              className={`h-8 text-xs ${on ? chip : "opacity-60"}`}
              aria-pressed={on}
              onClick={() =>
                setContentTypeFilters((prev) => ({
                  ...prev,
                  [key]: !prev[key],
                }))
              }
            >
              {label}
            </Button>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-xs text-muted-foreground"
          onClick={() =>
            setContentTypeFilters({ reel: true, static_post: true, carousel: true })
          }
        >
          Show all
        </Button>
      </div>

      {loading ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, idx) => (
              <Skeleton key={idx} className="h-10 w-full" />
            ))}
          </div>
        </div>
      ) : (tasks || []).length === 0 ? (
        <EmptyState
          icon={CalendarIcon}
          title="No calendar items"
          description="Nothing is scheduled for this month yet."
        />
      ) : filteredTasks.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No tasks match the current filters</p>
            <p className="mt-1">
              Turn on at least one of <strong>Reel</strong>, <strong>Static post</strong>, or <strong>Carousel</strong>,
              or click <strong>Show all</strong>.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div
            ref={gridScrollRef}
            onMouseDown={handleGridMouseDown}
            className={`rounded-xl border border-border bg-card overflow-auto ${
              isPanningGrid ? "cursor-grabbing select-none" : "cursor-grab"
            }`}
          >
            <div
              className="grid min-w-[2200px]"
              style={{ gridTemplateColumns: `280px repeat(${calendarDays.length}, minmax(120px, 1fr))` }}
            >
              <div className="sticky left-0 z-20 border-b border-r border-border bg-muted/50 px-3 py-2 text-xs font-semibold">
                Role / User
              </div>
              {calendarDays.map((d) => (
                (() => {
                  const isPastDay = isCurrentMonthView && d.ymd < todayYmd;
                  const isHoliday = holidayByDay.has(d.ymd);
                  return (
                <div
                  key={d.ymd}
                  data-gc-col-day="true"
                  className={`border-b border-r border-border px-2 py-2 text-center text-xs font-semibold ${
                    isHoliday
                      ? "bg-gray-300/40 dark:bg-gray-700/40"
                      : isPastDay
                        ? "bg-slate-300/35 dark:bg-slate-700/35"
                        : "bg-muted/30"
                  }`}
                  title={isHoliday ? `${holidayByDay.get(d.ymd)} (Holiday)` : ""}
                >
                  <p className="leading-tight">{d.dayNum}</p>
                  <p className="text-[10px] font-normal text-muted-foreground leading-tight">
                    {weekdayShortUTC(d.ymd)}
                  </p>
                </div>
                  );
                })()
              ))}

              {groupedRows.map((group) => (
                <div key={group.role} className="contents">
                  <div className="sticky left-0 z-10 border-b border-r border-border bg-muted/40 px-3 py-2 text-xs font-semibold">
                    {roleLabel[group.role] || group.role}
                  </div>
                  {calendarDays.map((day) => (
                    <div key={`${group.role}-hdr-${day.ymd}`} className="border-b border-r border-border bg-muted/10" />
                  ))}

                  {group.rows.map((row) => (
                    <div key={`${group.role}-${row.userId}`} className="contents">
                      <div className="sticky left-0 z-10 border-b border-r border-border bg-card px-3 py-3 text-sm font-medium">
                        {row.name}
                      </div>
                      {calendarDays.map((day) => {
                        const dayTasks = row.byDay.get(day.ymd) || [];
                        const onLeave = leaveByUserDay.has(`${row.userId}::${day.ymd}`);
                        const isHoliday = holidayByDay.has(day.ymd);
                        const isPastDay = isCurrentMonthView && day.ymd < todayYmd;
                        const bucketKeys = ["reel", "static_post", "carousel"];
                        const bucketStats = bucketKeys.map((bucket) => {
                          const used = Number(
                            usedByUserDayType.get(`${row.userId}::${day.ymd}::${bucket}`) || 0
                          );
                          const capacity = getRoleBucketCapacity(row.role, bucket);
                          return { bucket, used, capacity };
                        });
                        const warningBuckets = bucketStats
                          .filter((x) => x.used > 0 && x.capacity > 0 && x.used >= x.capacity)
                          .map((x) => {
                            const label =
                              x.bucket === "reel"
                                ? "Reel"
                                : x.bucket === "static_post"
                                  ? "Post"
                                  : "Carousel";
                            const overloaded = x.used > x.capacity;
                            return {
                              ...x,
                              label,
                              overloaded,
                              reason: `${label} ${x.used}/${x.capacity} (${overloaded ? "over capacity" : "at capacity"})`,
                            };
                          });
                        const overloadedBuckets = new Set(
                          warningBuckets.filter((x) => x.overloaded).map((x) => x.bucket)
                        );
                        const fullBuckets = new Set(
                          warningBuckets.filter((x) => !x.overloaded).map((x) => x.bucket)
                        );
                        const isOverloaded = warningBuckets.some((x) => x.overloaded);
                        const isFull = !isOverloaded && warningBuckets.length > 0;
                        const capacityReason = warningBuckets.map((x) => x.reason).join(" • ");
                        return (
                          <div
                            key={`${row.userId}-${day.ymd}`}
                            data-gc-user={String(row.userId || "")}
                            data-gc-ymd={String(day.ymd || "")}
                            className={`flex min-h-28 flex-col border-b border-r border-border p-2 ${
                              isHoliday
                                ? "bg-gray-300/40 dark:bg-gray-700/40"
                                : isPastDay
                                  ? "bg-slate-300/35 dark:bg-slate-700/35"
                                : onLeave
                                  ? "bg-red-500/15"
                                  : ""
                            } ${
                              isOverloaded
                                ? "border-red-600/80 bg-red-500/12 ring-2 ring-inset ring-red-500/55"
                                : ""
                            } ${
                              draggingTaskId && hoveredDropCell === `${row.userId}::${day.ymd}`
                                ? canDropOnCell(row, day.ymd)
                                  ? "ring-2 ring-emerald-500/70 bg-emerald-500/15"
                                  : "ring-2 ring-red-500/70 bg-red-500/15"
                                : ""
                            } ${
                              highlightedCell === `${String(row.userId || "")}::${String(day.ymd || "")}`
                                ? "ring-2 ring-amber-500/80 bg-amber-500/20 transition-colors duration-300"
                                : ""
                            }`}
                            title={
                              isHoliday
                                ? `${holidayByDay.get(day.ymd)} (Holiday)`
                                : onLeave
                                ? "User on leave"
                                : isOverloaded
                                ? `OVERLOADED — ${capacityReason}`
                                : isFull
                                  ? `FULL — ${capacityReason}`
                                : isBeforeTodayYmd(day.ymd)
                                ? "Past date (drag/drop disabled)"
                                : !weekendMode && isWeekendYmd(day.ymd)
                                ? "Weekend blocked"
                                : ""
                            }
                            onDragOver={(e) => {
                              e.preventDefault();
                              if (draggingTaskId) {
                                setHoveredDropCell(`${row.userId}::${day.ymd}`);
                              }
                            }}
                            onDragLeave={() => {
                              if (hoveredDropCell === `${row.userId}::${day.ymd}`) {
                                setHoveredDropCell("");
                              }
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              handleDrop(e, row, day.ymd);
                            }}
                          >
                            {isHoliday ? (
                              <p className="text-xs text-muted-foreground">Holiday</p>
                            ) : null}
                            {onLeave && dayTasks.length === 0 ? (
                              <p className="text-xs text-red-700 dark:text-red-300">On leave</p>
                            ) : null}
                            {dayTasks.length > 0 ? (
                            <div className="mt-1 flex min-h-0 min-w-0 flex-1 flex-col gap-1">
                              {/* ~2 full cards visible; scroll for the rest */}
                              <div
                                className="max-h-[210px] min-h-0 space-y-1 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-gutter:stable] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent"
                              >
                              {dayTasks.map((task) => {
                              const ctLabel = contentTypeLabel(task.contentType);
                              const taskBucket = normalizeContentTypeFilterKey(task.contentType);
                              const taskUsed = Number(
                                usedByUserDayType.get(`${row.userId}::${day.ymd}::${taskBucket}`) || 0
                              );
                              const taskCapacity = getRoleBucketCapacity(row.role, taskBucket);
                              const taskIsOverloaded = overloadedBuckets.has(taskBucket);
                              const taskIsFull = !taskIsOverloaded && fullBuckets.has(taskBucket);
                              const taskCapacityReason =
                                `${ctLabel} ${taskUsed}/${taskCapacity} (${taskIsOverloaded ? "over capacity" : "at capacity"})`;
                              const taskLoadClass =
                                taskIsOverloaded
                                  ? "border-red-600/80 bg-red-500/20 text-red-900 dark:text-red-100"
                                  : taskIsFull
                                    ? "border-blue-600/80 bg-blue-500/20 text-blue-900 dark:text-blue-100"
                                    : "";
                              const urgent = String(task.priority || "").toLowerCase() === "urgent";
                              const planType = urgent ? "URGENT" : "NORMAL";
                              const hasConflict = Boolean(
                                task?.conflict ||
                                  task?.hasConflict ||
                                  task?.isConflict ||
                                  task?.conflictFlag
                              );
                              const conflictReason =
                                task?.conflictReason ||
                                task?.reason ||
                                task?.conflictMessage ||
                                "";
                              const taskId = String(task.taskId || "");
                              // PROMPT: derive duration/span dynamically from assignedUsersPerDay.
                              const perDay = task?.assignedUsersPerDay && typeof task.assignedUsersPerDay === "object"
                                ? task.assignedUsersPerDay
                                : {};
                              const taskDaysForRow = Object.entries(perDay)
                                .filter(([, uid]) => String(uid || "") === String(row.userId || ""))
                                .map(([ymd]) => ymd)
                                .sort();
                              const prevDay = addDaysToYMD(day.ymd, -1);
                              const nextDay = addDaysToYMD(day.ymd, 1);
                              const hasPrev = taskDaysForRow.includes(prevDay);
                              const hasNext = taskDaysForRow.includes(nextDay);
                              const isStart = !hasPrev;
                              const isEnd = !hasNext;
                              const dynamicDuration = taskDaysForRow.length || 1;
                              const clientKey = String(task?.clientId || task?.clientName || "");
                              const clientColor = clientColorByKey.get(clientKey) || CLIENT_COLOR_PALETTE[0];
                              const normalStyle = {
                                backgroundColor: clientColor.bg,
                                borderColor: clientColor.border,
                              };

                              return (
                                <div
                                  key={`${task.taskId}-${day.ymd}`}
                                  data-task-card="true"
                                  draggable={Boolean(!dragBusy && canEditTask(task))}
                                  onClick={() => {
                                    if (!canEditTask(task)) return;
                                    const recentlyDragged =
                                      String(lastDragEndRef.current.taskId || "") === String(task.taskId || "") &&
                                      Date.now() - Number(lastDragEndRef.current.at || 0) < 220;
                                    if (recentlyDragged) return;
                                    setSelectedTask({ task, day: day.ymd, userId: row.userId });
                                  }}
                                  onDragStart={(e) => {
                                    if (!canEditTask(task)) {
                                      e.preventDefault();
                                      return;
                                    }
                                    if (e?.dataTransfer) {
                                      e.dataTransfer.setData("taskId", String(task.taskId || ""));
                                      e.dataTransfer.setData("itemId", String(task.contentItemId || ""));
                                      e.dataTransfer.setData("stageId", String(task.stageId || ""));
                                      e.dataTransfer.effectAllowed = "move";
                                    }
                                    setDraggingTaskId(String(task.taskId || ""));
                                    setHoveredDropCell("");
                                    setDropError("");
                                  }}
                                  onDragEnd={() => {
                                    lastDragEndRef.current = {
                                      taskId: String(task.taskId || ""),
                                      at: Date.now(),
                                    };
                                    setDraggingTaskId("");
                                    setHoveredDropCell("");
                                  }}
                                  className={`border px-2 py-1.5 text-xs leading-snug shadow-sm ${
                                    hasConflict
                                      ? "border-red-600/80 bg-red-500/10 text-red-700 dark:text-red-200"
                                      : taskLoadClass
                                        ? taskLoadClass
                                      : "text-foreground dark:text-slate-100"
                                  } ${isStart ? "rounded-l" : "rounded-l-none"} ${isEnd ? "rounded-r" : "rounded-r-none"} ${
                                    onLeave || isHoliday ? "cursor-not-allowed opacity-80" : ""
                                  } ${dragBusy ? "opacity-70" : ""} relative ${
                                    canEditTask(task)
                                      ? "cursor-pointer"
                                      : isStrategist
                                        ? "disabled-task pointer-events-none opacity-40 grayscale-[80%] cursor-not-allowed"
                                        : "cursor-pointer"
                                  } select-none`}
                                  style={
                                    !hasConflict && !urgent && !taskLoadClass ? normalStyle : undefined
                                  }
                                  title={
                                    !canEditTask(task)
                                      ? "You can only modify tasks of your assigned clients"
                                      : isHoliday
                                      ? `${holidayByDay.get(day.ymd)} (Holiday)`
                                      : onLeave
                                      ? "User on leave"
                                      : isOverloaded
                                        ? `OVERLOADED — ${capacityReason}`
                                        : isFull
                                          ? `FULL — ${capacityReason}`
                                      : taskIsOverloaded
                                        ? `OVERLOADED — ${taskCapacityReason}`
                                      : taskIsFull
                                        ? `FULL — ${taskCapacityReason}`
                                      : hasConflict
                                      ? conflictReason || "Scheduling conflict"
                                      : `${task.clientName} • ${ctLabel} • ${task.title} • ${task.stageName}`
                                  }
                                >
                                  {task?.isCustomCalendar !== false && !dragBusy ? (
                                    <span
                                      className="pointer-events-none absolute left-1 top-1 z-10 inline-flex h-4 w-4 items-center justify-center rounded border border-border/60 bg-background/80 text-muted-foreground"
                                      title="Drag this card"
                                    >
                                      <GripVertical className="h-3 w-3" />
                                    </span>
                                  ) : null}
                                  {isStart ? (
                                    <>
                                      <p className="truncate font-semibold inline-flex items-center gap-1">
                                        {task.clientName}
                                        {taskIsOverloaded ? (
                                          <AlertTriangle className="h-3 w-3 shrink-0 text-red-600" />
                                        ) : null}
                                        {hasConflict ? (
                                          <AlertTriangle className="h-3 w-3 shrink-0 text-red-600" />
                                        ) : null}
                                      </p>
                                      <div className="mb-1 flex flex-wrap items-center gap-1">
                                        <span
                                          className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide border ${contentTypeChipClassName(task.contentType)}`}
                                        >
                                          {ctLabel}
                                        </span>
                                        <span
                                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                                            urgent
                                              ? "bg-red-600/80 text-white"
                                              : "border border-border bg-background/80 text-foreground"
                                          }`}
                                        >
                                          {planType}
                                        </span>
                                      </div>
                                      <p className="truncate opacity-95">{task.stageName}</p>
                                      <p className="truncate opacity-80">
                                        {userMetaById.get(row.userId)?.name || row.name}
                                      </p>
                                      <p className="truncate opacity-70">{dynamicDuration}d</p>
                                    </>
                                  ) : (
                                    <>
                                      {taskIsOverloaded ? (
                                        <AlertTriangle className="mb-0.5 h-3 w-3 shrink-0 text-red-600" />
                                      ) : null}
                                      <span
                                        className={`mb-0.5 inline-block rounded px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide border ${contentTypeChipClassName(task.contentType)}`}
                                      >
                                        {ctLabel}
                                      </span>
                                      <p className="truncate opacity-80">
                                        {userMetaById.get(row.userId)?.name || row.name}
                                      </p>
                                    </>
                                  )}
                                </div>
                              );
                              })}
                              </div>
                              {dayTasks.length > 1 ? (
                                <div className="flex shrink-0 justify-center border-t border-border/60 pt-1">
                                  <button
                                    type="button"
                                    className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                                    title={`Open expanded view (${dayTasks.length} tasks)`}
                                    aria-label={`Open expanded view of ${dayTasks.length} tasks`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setCellOverflow({ row, dayYmd: day.ymd, tasks: dayTasks });
                                    }}
                                  >
                                    <MoreHorizontal className="h-4 w-4" />
                                  </button>
                                </div>
                              ) : null}
                              {isOverloaded ? (
                                <div className="mt-1 shrink-0 rounded-sm border border-red-600/60 bg-red-500/15 px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">
                                  Overloaded
                                </div>
                              ) : null}
                            </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          {hasAnyOverloaded ? (
            <div className="mt-3 rounded-md border border-red-600/60 bg-red-500/15 px-3 py-2 text-sm font-semibold text-red-700 dark:text-red-300">
              Overloaded
            </div>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Legend</CardTitle>
              <p className="text-xs text-muted-foreground">
                Global schedule only (`GET /api/manager/global-calendar`) • grouped by Role → User
              </p>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="outline">Urgent = red</Badge>
              <Badge variant="outline">Normal = primary</Badge>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${contentTypeChipClassName("reel")}`}
              >
                Reel
              </span>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${contentTypeChipClassName("static_post")}`}
              >
                Post
              </span>
              <span
                className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${contentTypeChipClassName("carousel")}`}
              >
                Carousel
              </span>
            </CardContent>
          </Card>
          {!isStrategist ? (
          <Card
            ref={leaveSectionRef}
            className={highlightLeaveSection ? "ring-2 ring-amber-500/80 bg-amber-500/10 transition-colors duration-300" : ""}
          >
            <CardHeader>
              <CardTitle>Leave Blocks</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                <select
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={leaveForm.userId}
                  onChange={(e) => setLeaveForm((p) => ({ ...p, userId: e.target.value }))}
                  disabled={leaveBusy}
                >
                  <option value="">Select user</option>
                  {(users || []).map((u) => (
                    <option key={String(u._id)} value={String(u._id)}>
                      {u.name || `User ${String(u._id).slice(-4)}`}
                    </option>
                  ))}
                </select>
                <Input
                  type="date"
                  value={leaveForm.startDate}
                  onChange={(e) => setLeaveForm((p) => ({ ...p, startDate: e.target.value }))}
                  disabled={leaveBusy}
                />
                <Input
                  type="date"
                  value={leaveForm.endDate}
                  onChange={(e) => setLeaveForm((p) => ({ ...p, endDate: e.target.value }))}
                  disabled={leaveBusy}
                />
                <Input
                  placeholder="Reason"
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm((p) => ({ ...p, reason: e.target.value }))}
                  disabled={leaveBusy}
                />
                <div className="flex gap-2">
                  <Button type="button" size="sm" onClick={handleSaveLeave} disabled={leaveBusy}>
                    {editingLeaveId ? "Update leave" : "Add leave"}
                  </Button>
                  {editingLeaveId ? (
                    <Button type="button" size="sm" variant="outline" onClick={resetLeaveForm} disabled={leaveBusy}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
              </div>
              {leaveFormError ? <p className="text-xs text-destructive">{leaveFormError}</p> : null}

              <div className="space-y-1 text-xs text-muted-foreground">
                {managerLeaves.length === 0 ? (
                  <p>No leave blocks for this month.</p>
                ) : (
                  managerLeaves.slice(0, 30).map((lb) => (
                    <div key={`${lb.leaveId || `${lb.userId}-${lb.startDate}-${lb.endDate}`}`} className="flex items-center justify-between gap-3 rounded border px-2 py-1">
                      <span>
                        {userMetaById.get(lb.userId)?.name || String(lb.userId).slice(-6)}: {lb.startDate} to {lb.endDate}
                        {lb.reason ? ` (${lb.reason})` : ""}
                      </span>
                      <span className="flex gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleEditLeave(lb)}
                          disabled={leaveBusy}
                        >
                          Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => handleDeleteLeave(lb.leaveId)}
                          disabled={leaveBusy || !lb.leaveId}
                        >
                          Delete
                        </Button>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
          ) : null}
        </>
      )}
      {dropError ? <p className="text-sm text-destructive whitespace-pre-line">{dropError}</p> : null}
      <Dialog open={Boolean(selectedTask)} onOpenChange={(open) => !open && setSelectedTask(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{selectedTaskDetails?.task?.clientName || "Task details"}</DialogTitle>
            <DialogDescription>
              Clicked day: {selectedTask?.day || "-"} | Stage: {selectedTaskDetails?.task?.stageName || "-"}
            </DialogDescription>
          </DialogHeader>
          {selectedTaskDetails ? (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 rounded border p-3">
                <p><span className="text-muted-foreground">Client:</span> {selectedTaskDetails.task.clientName || "-"}</p>
                <p><span className="text-muted-foreground">Title:</span> {selectedTaskDetails.task.title || "-"}</p>
                <p>
                  <span className="text-muted-foreground">Format:</span>{" "}
                  <span
                    className={`inline-flex rounded border px-1.5 py-0.5 text-xs font-semibold ${contentTypeChipClassName(selectedTaskDetails.task.contentType)}`}
                  >
                    {contentTypeLabel(selectedTaskDetails.task.contentType)}
                  </span>
                </p>
                <p><span className="text-muted-foreground">Role:</span> {selectedTaskDetails.task.role || "-"}</p>
                <p><span className="text-muted-foreground">Priority:</span> {selectedTaskDetails.task.priority || "normal"}</p>
                <p><span className="text-muted-foreground">Start:</span> {String(selectedTaskDetails.task.startDate || "").slice(0, 10) || "-"}</p>
                <p><span className="text-muted-foreground">End:</span> {String(selectedTaskDetails.task.endDate || "").slice(0, 10) || "-"}</p>
                <p><span className="text-muted-foreground">Duration:</span> {selectedTaskDetails.task.finalDuration || selectedTaskDetails.task.durationDays || 1} day(s)</p>
                <p><span className="text-muted-foreground">Editable:</span> {selectedTaskDetails.task.isEditable ? "Yes" : "No"}</p>
              </div>
              <div className="rounded border p-3">
                <p className="mb-2 font-medium">Assigned Users Per Day</p>
                <div className="max-h-52 space-y-1 overflow-auto text-xs">
                  {selectedTaskDetails.assignments.length === 0 ? (
                    <p className="text-muted-foreground">No day-wise assignment available.</p>
                  ) : (
                    selectedTaskDetails.assignments.map((a) => (
                      <div key={`${a.day}-${a.userId}`} className="flex items-center justify-between rounded bg-muted/30 px-2 py-1">
                        <span>{a.day}</span>
                        <span>{a.userName}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              {selectedTaskDetails.task?.conflictReason ? (
                <p className="rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-200">
                  Conflict: {selectedTaskDetails.task.conflictReason}
                </p>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(cellOverflow)} onOpenChange={(open) => !open && setCellOverflow(null)}>
        <DialogContent className="max-h-[min(85vh,720px)] max-w-lg gap-0 overflow-y-auto p-0 sm:max-w-xl">
          <DialogHeader className="border-b border-border px-6 py-4 text-left">
            <DialogTitle className="text-lg">
              {cellOverflow ? `${cellOverflow.row.name}` : ""}
              {cellOverflow ? (
                <span className="block text-sm font-normal text-muted-foreground">
                  {cellOverflow.dayYmd}
                  {cellOverflow.tasks?.length ? ` · ${cellOverflow.tasks.length} tasks` : ""}
                </span>
              ) : null}
            </DialogTitle>
            <DialogDescription className="text-left text-sm">
              Select a task to open full details.
            </DialogDescription>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`rounded border px-2 py-1 font-semibold ${contentTypeChipClassName("reel")}`}
              >
                Reel: {overflowContentTypeCounts.reel}
              </span>
              <span
                className={`rounded border px-2 py-1 font-semibold ${contentTypeChipClassName("static_post")}`}
              >
                Post: {overflowContentTypeCounts.static_post}
              </span>
              <span
                className={`rounded border px-2 py-1 font-semibold ${contentTypeChipClassName("carousel")}`}
              >
                Carousel: {overflowContentTypeCounts.carousel}
              </span>
            </div>
          </DialogHeader>
          <div className="border-b border-border/60 px-6 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                Card {Math.min((cellOverflow?.tasks || []).length, overflowSlideIndex + 1)} of{" "}
                {(cellOverflow?.tasks || []).length || 0}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  onClick={() => scrollOverflowCarousel("prev")}
                  disabled={!(cellOverflow?.tasks || []).length}
                  title="Previous task"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-7 w-7"
                  onClick={() => scrollOverflowCarousel("next")}
                  disabled={!(cellOverflow?.tasks || []).length}
                  title="Next task"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={
                    (selectedOverflowTaskIds || []).length > 0 &&
                    (selectedOverflowTaskIds || []).length ===
                      (cellOverflow?.tasks || []).filter((t) => canEditTask(t)).length
                  }
                  onChange={(e) => {
                    const editableTasks = (cellOverflow?.tasks || []).filter((t) => canEditTask(t));
                    if (e.target.checked) {
                      setSelectedOverflowTaskIds(
                        editableTasks.map((t, idx) =>
                          String(t?.taskId || `${String(t?.contentItemId || "")}-${idx}`)
                        )
                      );
                    } else {
                      setSelectedOverflowTaskIds([]);
                    }
                  }}
                  disabled={bulkMoveBusy}
                />
                Select all
              </label>
              <select
                className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                value={bulkMoveTargetUserId}
                onChange={(e) => setBulkMoveTargetUserId(e.target.value)}
                disabled={bulkMoveBusy || bulkMoveTargetUsers.length === 0}
              >
                <option value="">Move selected to...</option>
                {bulkMoveTargetUsers.map((u) => (
                  <option key={String(u._id)} value={String(u._id)}>
                    {u.name || String(u._id).slice(-6)}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleBulkMoveSelected}
                disabled={
                  bulkMoveBusy ||
                  !bulkMoveTargetUserId ||
                  (selectedOverflowTaskIds || []).length === 0
                }
              >
                {bulkMoveBusy ? "Moving..." : "Move selected"}
              </Button>
            </div>
          </div>
          <div
            ref={overflowCarouselRef}
            onScroll={handleOverflowCarouselScroll}
            className="flex snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden px-6 py-4"
          >
            {(cellOverflow?.tasks || []).map((task, idx) => {
              const ctLabel = contentTypeLabel(task.contentType);
              const urgent = String(task.priority || "").toLowerCase() === "urgent";
              const planType = urgent ? "URGENT" : "NORMAL";
              const hasConflict = Boolean(
                task?.conflict || task?.hasConflict || task?.isConflict || task?.conflictFlag
              );
              const conflictReason =
                task?.conflictReason || task?.reason || task?.conflictMessage || "";
              const perDay =
                task?.assignedUsersPerDay && typeof task.assignedUsersPerDay === "object"
                  ? task.assignedUsersPerDay
                  : {};
              const taskDaysForRow = Object.entries(perDay)
                .filter(([, uid]) => String(uid || "") === String(cellOverflow.row.userId || ""))
                .map(([ymd]) => ymd)
                .sort();
              const dynamicDuration = taskDaysForRow.length || 1;
              const clientKey = String(task?.clientId || task?.clientName || "");
              const clientColor = clientColorByKey.get(clientKey) || CLIENT_COLOR_PALETTE[0];
              const row = cellOverflow.row;

              return (
                <div
                  key={`${String(task.taskId || idx)}-${idx}`}
                  className={`min-w-[85%] snap-start rounded-xl border px-4 py-3 text-left text-sm shadow-sm transition hover:opacity-95 sm:min-w-[78%] ${
                    hasConflict
                      ? "border-red-600/70 bg-red-500/10 text-red-900 dark:text-red-100"
                      : "border-border bg-card text-foreground"
                  }`}
                  style={
                    !hasConflict && !urgent
                      ? { backgroundColor: clientColor.bg, borderColor: clientColor.border }
                      : undefined
                  }
                  onClick={() => {
                    const payload = cellOverflow;
                    setCellOverflow(null);
                    if (payload) setSelectedTask({ task, day: payload.dayYmd, userId: payload.row.userId });
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      const payload = cellOverflow;
                      setCellOverflow(null);
                      if (payload) setSelectedTask({ task, day: payload.dayYmd, userId: payload.row.userId });
                    }
                  }}
                >
                  <div className="mb-2">
                    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={selectedOverflowTaskIds.includes(
                          String(task?.taskId || `${String(task?.contentItemId || "")}-${idx}`)
                        )}
                        disabled={bulkMoveBusy || !canEditTask(task)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation();
                          const taskId = String(
                            task?.taskId || `${String(task?.contentItemId || "")}-${idx}`
                          );
                          setSelectedOverflowTaskIds((prev) =>
                            e.target.checked
                              ? Array.from(new Set([...prev, taskId]))
                              : prev.filter((id) => String(id) !== taskId)
                          );
                        }}
                      />
                      Select
                    </label>
                  </div>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="text-base font-semibold leading-tight inline-flex items-center gap-2">
                        {task.clientName}
                        {hasConflict ? <AlertTriangle className="h-4 w-4 shrink-0 text-red-600" /> : null}
                      </p>
                      <p className="text-sm text-muted-foreground">{task.title || "—"}</p>
                      <p className="font-medium">{task.stageName}</p>
                      <p className="text-xs text-muted-foreground">
                        {userMetaById.get(row.userId)?.name || row.name} · {dynamicDuration} day
                        {dynamicDuration === 1 ? "" : "s"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span
                        className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide border ${contentTypeChipClassName(task.contentType)}`}
                      >
                        {ctLabel}
                      </span>
                      <span
                        className={`rounded px-2 py-1 text-xs font-semibold ${
                          urgent ? "bg-red-600 text-white" : "border border-border bg-background/90"
                        }`}
                      >
                        {planType}
                      </span>
                    </div>
                  </div>
                  {hasConflict && conflictReason ? (
                    <p className="mt-2 rounded border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-800 dark:text-red-200">
                      {conflictReason}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default function ManagerGlobalCalendarPage() {
  return <GlobalCalendarPage actor="manager" />;
}

