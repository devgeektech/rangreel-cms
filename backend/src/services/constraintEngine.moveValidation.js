const { isUserOnLeaveForDay } = require("./availability.service");
const {
  getMinDaysForWorkflowRole,
  REEL_PIPELINE,
  POST_LIKE_PIPELINE,
} = require("./durationBorrowing.service");
const { canBorrowFromPipelineTask } = require("./durationValidation.service");

function startOfDayUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDaysUTC(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toYmdUTC(d) {
  const x = startOfDayUTC(d);
  if (!x) return "";
  return x.toISOString().slice(0, 10);
}

function normalizeRoleKey(role) {
  return String(role || "").toLowerCase();
}

function normalizeWorkflowRoleForMinDays(role) {
  const lower = normalizeRoleKey(role);
  const map = {
    videoeditor: "videoEditor",
    videographer: "videographer",
    strategist: "strategist",
    graphicdesigner: "graphicDesigner",
    manager: "manager",
    postingexecutive: "postingExecutive",
  };
  return map[lower] || role;
}

function getPipelineKind(tasks) {
  const roles = new Set((tasks || []).map((t) => normalizeRoleKey(t?.role)));
  if (roles.has("videoeditor") || roles.has("videographer")) return "reel";
  return "post_like";
}

/**
 * Next workflow task in the same pipeline (reel vs post-like).
 * @param {object} task
 * @param {object[]} tasks
 * @returns {object|null}
 */
function getNextStageTask(task, tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const pipelineKind = getPipelineKind(list);
  const chain = pipelineKind === "post_like" ? POST_LIKE_PIPELINE : REEL_PIPELINE;
  const cur = normalizeRoleKey(task?.role);
  const idx = chain.findIndex((r) => r.toLowerCase() === cur);
  if (idx < 0 || idx >= chain.length - 1) return null;
  const wantNext = chain[idx + 1].toLowerCase();
  return list.find((t) => normalizeRoleKey(t?.role) === wantNext) || null;
}

/**
 * @param {object} task — duration task or draft task with durationDays / startDate / endDate
 * @returns {number}
 */
function getTaskDuration(task) {
  if (task == null) return 1;
  const d = Number(task.durationDays);
  if (Number.isFinite(d) && d >= 1) return Math.floor(d);
  if (task.startDate != null && task.endDate != null) {
    const a = startOfDayUTC(task.startDate);
    const b = startOfDayUTC(task.endDate);
    if (a && b) {
      const diff = Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
      return Math.max(1, diff);
    }
  }
  return 1;
}

function isSameTask(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const ida = a.taskId ?? a._id;
  const idb = b.taskId ?? b._id;
  if (ida != null && idb != null && String(ida) === String(idb)) return true;
  return false;
}

function taskWindowYmds(task, movedTask, newDate) {
  const moved = isSameTask(task, movedTask);
  const dur = Math.max(1, getTaskDuration(task));
  const start = moved ? startOfDayUTC(newDate) : startOfDayUTC(task?.startDate ?? task?.date);
  if (!start) return { startYmd: "", endYmd: "" };
  const end = addDaysUTC(start, dur - 1);
  return { startYmd: toYmdUTC(start), endYmd: toYmdUTC(end) };
}

function rolesAreEditAndApprovalPipelineRoles(roleA, roleB) {
  return normalizeRoleKey(roleA) === "videoeditor" && normalizeRoleKey(roleB) === "manager";
}

/**
 * True when the current stage needs extra calendar days (leave, explicit hints, or duration above min).
 * @param {object} task
 * @param {Date|string|number} newDate
 * @param {object[]} tasks
 */
function taskNeedsExtraDays(task, newDate, tasks) {
  if (task?.needsExtraDays === true || task?.needsBorrow === true) return true;

  const leaves = Array.isArray(task?.leaves) ? task.leaves : [];
  const uid = task?.assignedUser ?? task?.assignedUserId;
  const dur = getTaskDuration(task);
  const start = startOfDayUTC(newDate);
  if (!start) return false;

  for (let i = 0; i < dur; i++) {
    const day = i === 0 ? start : addDaysUTC(start, i);
    if (uid && isUserOnLeaveForDay(uid, day, leaves)) return true;
  }

  const wr = normalizeWorkflowRoleForMinDays(task?.role);
  const minD = getMinDaysForWorkflowRole(wr);
  if (Number.isFinite(Number(task?.durationDays)) && Number(task.durationDays) > minD) {
    return true;
  }

  void tasks;
  return false;
}

/**
 * Sequence / duration ordering after a hypothetical move (when borrowing does not apply).
 * @returns {{ isValid: boolean, reason?: string, details?: object }}
 */
function validateSequenceAfterMove(movedTask, newDate, tasks) {
  const list = Array.isArray(tasks) ? tasks : [];
  const pipelineKind = getPipelineKind(list);
  const chain = pipelineKind === "post_like" ? POST_LIKE_PIPELINE : REEL_PIPELINE;

  for (let i = 0; i < chain.length - 1; i++) {
    const ra = chain[i];
    const rb = chain[i + 1];
    const ta = list.find((t) => normalizeRoleKey(t?.role) === ra.toLowerCase());
    const tb = list.find((t) => normalizeRoleKey(t?.role) === rb.toLowerCase());
    if (!ta || !tb) continue;

    const wa = taskWindowYmds(ta, movedTask, newDate);
    const wb = taskWindowYmds(tb, movedTask, newDate);
    if (!wa.endYmd || !wb.startYmd) continue;

    if (wa.endYmd < wb.startYmd) continue;
    if (wa.endYmd === wb.startYmd && rolesAreEditAndApprovalPipelineRoles(ra, rb)) continue;

    return {
      isValid: false,
      reason: "Task sequence would be violated by this drag",
      details: {
        code: "SEQUENCE_VIOLATION",
        from: ra,
        to: rb,
      },
    };
  }

  return { isValid: true, reason: "" };
}

/**
 * PROMPT 106 — Validate moving `task` to `newDate` against sibling `tasks`.
 * Before rejecting due to sequence/duration, allows borrowing when the next stage has duration &gt; 1
 * and the current task needs extra days (leave / unavailability / hints).
 *
 * @param {object} task — task being moved (must have `role`)
 * @param {Date|string|number} newDate
 * @param {object[]} tasks — all duration tasks for the same content item
 * @returns {{ isValid: boolean, reason?: string, allowBorrow?: boolean, details?: object }}
 */
function validateMove(task, newDate, tasks) {
  if (!task || newDate == null) {
    return { isValid: false, reason: "missing_task_or_date", allowBorrow: false };
  }
  const list = Array.isArray(tasks) ? tasks : [];
  if (list.length === 0) {
    return { isValid: false, reason: "no_tasks", allowBorrow: false };
  }

  const needsExtra = taskNeedsExtraDays(task, newDate, list);
  const nextTask = getNextStageTask(task, list);

  if (needsExtra && nextTask && canBorrowFromPipelineTask(nextTask)) {
    return {
      isValid: true,
      reason: "Borrowing from next stage allowed",
      allowBorrow: true,
    };
  }

  return validateSequenceAfterMove(task, newDate, list);
}

module.exports = {
  validateMove,
  getNextStageTask,
  getTaskDuration,
  taskNeedsExtraDays,
  validateSequenceAfterMove,
};
