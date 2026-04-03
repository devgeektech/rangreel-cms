"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
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

export default function ManagerGlobalCalendarPage() {
  const DEFAULT_ROLE_CAPACITY = 5;
  const [month, setMonth] = useState(() => toMonthStringUTC(new Date()));
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [leaveEntries, setLeaveEntries] = useState([]);
  const [leaveBlocks, setLeaveBlocks] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [capacityByRole, setCapacityByRole] = useState({});
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

  const loadCalendar = async () => {
    try {
      setLoading(true);
      // Single global source for manager calendar.
      const [calendarRes, teamUsersRes, leaveRes, holidayRes] = await Promise.all([
        api.getManagerGlobalCalendar(month),
        api.getTeamUsers(),
        api.getManagerLeave(),
        api.getHoliday(),
      ]);
      const capRes = await api.getTeamCapacity().catch(() => ({ data: [] }));
      const data = calendarRes?.data || calendarRes || {};
      setTasks(data?.updatedTasks || data?.tasks || []);
      setUsers(teamUsersRes?.data || []);
      setLeaveEntries(leaveRes?.data || leaveRes || []);
      setLeaveBlocks(data?.leaveBlocks || []);
      setHolidays(holidayRes?.data || holidayRes || []);
      const capRows = capRes?.data || [];
      const capMap = {};
      for (const row of capRows) {
        const role = normalizeRoleKey(row?.role);
        const cap = Number(row?.dailyCapacity);
        if (!role) continue;
        capMap[role] = Number.isFinite(cap) && cap > 0 ? cap : DEFAULT_ROLE_CAPACITY;
      }
      setCapacityByRole(capMap);
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
    for (const task of tasks || []) {
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
  }, [tasks, users, userMetaById]);

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

  const usedByUserDay = useMemo(() => {
    const map = new Map();
    const seen = new Set(); // user::day::taskId
    for (const task of tasks || []) {
      const perDay = task?.assignedUsersPerDay && typeof task.assignedUsersPerDay === "object"
        ? task.assignedUsersPerDay
        : {};
      const fallbackTaskId = `${String(task?.contentItemId || "")}-${String(task?.stageName || "")}-${String(
        task?.startDate || task?.date || ""
      )}`;
      const taskIdKey = String(task?.taskId || fallbackTaskId);
      for (const [day, dayUser] of Object.entries(perDay)) {
        const userId = String(dayUser || "unassigned");
        const dedupeKey = `${userId}::${day}::${taskIdKey}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        const key = `${userId}::${day}`;
        map.set(key, (map.get(key) || 0) + 1);
      }
    }
    return map;
  }, [tasks]);

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

  const canDropOnCell = (row, ymd) => {
    const onLeave = leaveByUserDay.has(`${row.userId}::${ymd}`);
    const isHoliday = holidayByDay.has(ymd);
    const totalCapacity = Number(capacityByRole[row.role] || DEFAULT_ROLE_CAPACITY);
    const used = Number(usedByUserDay.get(`${row.userId}::${ymd}`) || 0);
    const isFull = used >= totalCapacity;
    const weekendBlocked = !weekendMode && isWeekendYmd(ymd);
    return !(onLeave || isHoliday || isFull || weekendBlocked);
  };

  const handleDrop = async (row, ymd) => {
    if (!draggingTaskId || dragBusy) return;
    const task = taskById.get(String(draggingTaskId));
    if (!task) return;
    if (!task?.isEditable) {
      const msg = "Task is not editable";
      setDropError(msg);
      toast.error(msg);
      return;
    }
    if (!canDropOnCell(row, ymd)) {
      const msg = "Cannot move: blocked by leave/holiday/capacity/weekend rule";
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
      await api.managerDragTask({
        contentId: task.contentItemId,
        stageName: task.stageName,
        newDate: ymd,
        allowWeekend: weekendMode,
        fromGlobalCalendar: true,
        ...(sameRoleAsRow ? { targetUserId: row.userId } : {}),
      });
      // Backend is source of truth: replace entire calendar state from API.
      await loadCalendar();
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
      // Update = delete + create (current API set has no PATCH leave endpoint).
      if (editingLeaveId) {
        await api.deleteManagerLeave(editingLeaveId);
      }
      await api.addManagerLeave({ userId, startDate, endDate, reason });
      toast.success(editingLeaveId ? "Leave updated" : "Leave added");
      resetLeaveForm();
      await loadCalendar();
    } catch (err) {
      const msg = err?.data?.reason || err?.message || "Failed to save leave";
      setLeaveFormError(msg);
      toast.error(msg);
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
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card overflow-auto">
            <div
              className="grid min-w-[2200px]"
              style={{ gridTemplateColumns: `280px repeat(${calendarDays.length}, minmax(120px, 1fr))` }}
            >
              <div className="sticky left-0 z-20 border-b border-r border-border bg-muted/50 px-3 py-2 text-xs font-semibold">
                Role / User
              </div>
              {calendarDays.map((d) => (
                <div
                  key={d.ymd}
                  className={`border-b border-r border-border px-2 py-2 text-center text-xs font-semibold ${
                    holidayByDay.has(d.ymd) ? "bg-gray-300/40 dark:bg-gray-700/40" : "bg-muted/30"
                  }`}
                  title={holidayByDay.has(d.ymd) ? `${holidayByDay.get(d.ymd)} (Holiday)` : ""}
                >
                  <p className="leading-tight">{d.dayNum}</p>
                  <p className="text-[10px] font-normal text-muted-foreground leading-tight">
                    {weekdayShortUTC(d.ymd)}
                  </p>
                </div>
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
                        {(() => {
                          const totalCapacity = Number(capacityByRole[row.role] || DEFAULT_ROLE_CAPACITY);
                          let peakUsed = 0;
                          for (const d of calendarDays) {
                            const used = Number(usedByUserDay.get(`${row.userId}::${d.ymd}`) || 0);
                            if (used > peakUsed) peakUsed = used;
                          }
                          return `${row.name} (${peakUsed}/${totalCapacity})`;
                        })()}
                      </div>
                      {calendarDays.map((day) => {
                        const dayTasks = row.byDay.get(day.ymd) || [];
                        const onLeave = leaveByUserDay.has(`${row.userId}::${day.ymd}`);
                        const isHoliday = holidayByDay.has(day.ymd);
                        const totalCapacity = Number(capacityByRole[row.role] || DEFAULT_ROLE_CAPACITY);
                        const used = Number(usedByUserDay.get(`${row.userId}::${day.ymd}`) || 0);
                        const isFull = used >= totalCapacity;
                        return (
                          <div
                            key={`${row.userId}-${day.ymd}`}
                            className={`min-h-28 border-b border-r border-border p-2 ${
                              isHoliday ? "bg-gray-300/40 dark:bg-gray-700/40" : onLeave ? "bg-blue-500/15" : ""
                            } ${
                              draggingTaskId && hoveredDropCell === `${row.userId}::${day.ymd}`
                                ? canDropOnCell(row, day.ymd)
                                  ? "ring-2 ring-emerald-500/70 bg-emerald-500/15"
                                  : "ring-2 ring-red-500/70 bg-red-500/15"
                                : ""
                            }`}
                            title={
                              isHoliday
                                ? `${holidayByDay.get(day.ymd)} (Holiday)`
                                : onLeave
                                ? "User on leave"
                                : isFull
                                ? "FULL"
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
                              handleDrop(row, day.ymd);
                            }}
                          >
                            {isFull ? (
                              <p className="text-xs font-semibold text-orange-700 dark:text-orange-300">FULL</p>
                            ) : null}
                            {isHoliday ? (
                              <p className="text-xs text-muted-foreground">Holiday</p>
                            ) : null}
                            {onLeave && dayTasks.length === 0 ? (
                              <p className="text-xs text-blue-700 dark:text-blue-200">On leave</p>
                            ) : null}
                            <div className="mt-1 max-h-36 space-y-1 overflow-y-auto pr-1">
                              {dayTasks.map((task) => {
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
                                  draggable={Boolean(task?.isEditable && !dragBusy)}
                                  onClick={() => {
                                    setSelectedTask({ task, day: day.ymd, userId: row.userId });
                                  }}
                                  onDragStart={() => {
                                    setDraggingTaskId(String(task.taskId || ""));
                                    setHoveredDropCell("");
                                    setDropError("");
                                  }}
                                  onDragEnd={() => {
                                    setDraggingTaskId("");
                                    setHoveredDropCell("");
                                  }}
                                  className={`border px-2 py-1.5 text-xs leading-snug shadow-sm ${
                                    hasConflict
                                      ? "border-red-600/80 bg-red-500/10 text-red-700 dark:text-red-200"
                                      : "text-foreground dark:text-slate-100"
                                  } ${isStart ? "rounded-l" : "rounded-l-none"} ${isEnd ? "rounded-r" : "rounded-r-none"} ${
                                    onLeave || isHoliday || isFull ? "cursor-not-allowed opacity-80" : ""
                                  } ${dragBusy ? "opacity-70" : ""} cursor-pointer`}
                                  style={!hasConflict && !urgent ? normalStyle : undefined}
                                  title={
                                    isHoliday
                                      ? `${holidayByDay.get(day.ymd)} (Holiday)`
                                      : onLeave
                                      ? "User on leave"
                                      : isFull
                                      ? "FULL"
                                      : hasConflict
                                      ? conflictReason || "Scheduling conflict"
                                      : `${task.clientName} • ${task.title} • ${task.stageName}`
                                  }
                                >
                                  {isStart ? (
                                    <>
                                      <p className="truncate font-semibold inline-flex items-center gap-1">
                                        {task.clientName}
                                        {hasConflict ? (
                                          <AlertTriangle className="h-3 w-3 shrink-0 text-red-600" />
                                        ) : null}
                                      </p>
                                      <div className="mb-1 flex items-center gap-1">
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
                                    <p className="truncate opacity-80">
                                      {userMetaById.get(row.userId)?.name || row.name}
                                    </p>
                                  )}
                                </div>
                              );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Legend</CardTitle>
              <p className="text-xs text-muted-foreground">
                Global schedule only (`GET /api/manager/global-calendar`) • grouped by Role → User
              </p>
            </CardHeader>
            <CardContent className="flex items-center gap-2 text-xs">
              <Badge variant="outline">Urgent = red</Badge>
              <Badge variant="outline">Normal = primary</Badge>
            </CardContent>
          </Card>
          <Card>
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
    </section>
  );
}

