const { ROLE_RULES } = require("../config/roleRules");
const { tryBorrowOneDayFromNextStage } = require("./durationBorrowing.service");

/**
 * PROMPT 58 — Duration-based task shape (per workflow stage).
 * @typedef {object} DurationTask
 * @property {string} taskId
 * @property {string} role — workflow role (e.g. videographer, videoEditor)
 * @property {string} startDate — YYYY-MM-DD (UTC calendar day)
 * @property {string} endDate — YYYY-MM-DD (inclusive)
 * @property {number} durationDays
 * @property {Record<string, string>} assignedUsersPerDay — YYYY-MM-DD → userId string
 */

/** Maps ContentItem.workflowStages[].role → ROLE_RULES key. */
const WORKFLOW_ROLE_TO_RULE_KEY = {
  strategist: "strategist",
  videographer: "shoot",
  videoEditor: "editor",
  manager: "manager",
  postingExecutive: "post",
};

const pad2 = (n) => String(n).padStart(2, "0");

function addDaysYMD(ymd, deltaDays) {
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(ymd).slice(0, 10);
  const dt = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

function toYmd(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function resolveRule(workflowRole) {
  const key = WORKFLOW_ROLE_TO_RULE_KEY[workflowRole];
  if (!key) return null;
  return ROLE_RULES[key] || null;
}

/**
 * Default duration from ROLE_RULES (minDays), clamped to maxDays.
 * Optional stage.durationDays overrides when within [minDays, maxDays].
 */
function resolveDurationDays(workflowRole, stageDurationOverride) {
  const rule = resolveRule(workflowRole);
  const minD = rule ? Math.max(1, Number(rule.minDays) || 1) : 1;
  const maxD =
    rule && Number.isFinite(Number(rule.maxDays))
      ? Math.max(minD, Number(rule.maxDays))
      : minD;

  if (Number.isFinite(stageDurationOverride) && stageDurationOverride >= 1) {
    const n = Math.floor(stageDurationOverride);
    return Math.min(Math.max(n, minD), maxD);
  }

  return minD;
}

function buildAssignedUsersPerDay(startYmd, durationDays, assignedUser) {
  const map = {};
  const uid =
    assignedUser != null
      ? String(assignedUser._id != null ? assignedUser._id : assignedUser)
      : "";
  for (let i = 0; i < durationDays; i++) {
    const ymd = addDaysYMD(startYmd, i);
    map[ymd] = uid;
  }
  return map;
}

/**
 * PROMPT 64 — Multi-user split: one user id per calendar day from scheduler output.
 * @param {Array<Date|string|number>} dates — booked workdays (UTC)
 * @param {Array<object|string>} assignees — parallel user ids
 * @returns {Record<string, string>}
 */
function buildAssignedUsersPerDayFromSchedule(dates, assignees) {
  const map = {};
  if (!Array.isArray(dates) || !Array.isArray(assignees)) return map;
  const n = Math.min(dates.length, assignees.length);
  for (let i = 0; i < n; i++) {
    const ymd = toYmd(dates[i]);
    if (!ymd) continue;
    const a = assignees[i];
    map[ymd] = a != null ? String(a._id != null ? a._id : a) : "";
  }
  return map;
}

/**
 * @param {string} contentId
 * @param {object} stage — `{ role, date|dueDate, assignedUser?, durationDays?, name? }`
 * @param {number} index
 * @returns {DurationTask}
 */
function normalizeStageToDurationTask(contentId, stage, index) {
  const role = stage.role || "";
  const startDate = toYmd(stage.date ?? stage.dueDate);
  if (!startDate) {
    return {
      taskId: `${String(contentId)}::${role || "unknown"}::missing-date::${index}`,
      role,
      startDate: "",
      endDate: "",
      durationDays: 0,
      assignedUsersPerDay: {},
    };
  }

  const durationDays = resolveDurationDays(role, stage.durationDays);
  const endDate = addDaysYMD(startDate, durationDays - 1);
  const taskId = `${String(contentId)}::${role}::${startDate}::${index}`;
  const perDay =
    stage.assignedUsersPerDay && typeof stage.assignedUsersPerDay === "object"
      ? { ...stage.assignedUsersPerDay }
      : buildAssignedUsersPerDay(startDate, durationDays, stage.assignedUser);
  return {
    taskId,
    role,
    startDate,
    endDate,
    durationDays,
    assignedUsersPerDay: perDay,
  };
}

/**
 * @param {string} contentId
 * @param {Array<object>} stages
 * @returns {DurationTask[]}
 */
function normalizeStagesToDurationTasks(contentId, stages) {
  if (!Array.isArray(stages)) return [];
  return stages.map((s, i) => normalizeStageToDurationTask(contentId, s, i));
}

/**
 * @param {{ contentId?: string, title?: string, stages?: Array<object> }} item
 * @returns {DurationTask[]}
 */
function normalizeDraftItemToDurationTasks(item) {
  const contentId = item?.contentId ?? item?.title ?? "item";
  return normalizeStagesToDurationTasks(contentId, item?.stages || []);
}

/**
 * PROMPT 62 / 63 — Duration extension: +1 day on flexible roles (respects ROLE_RULES.maxDays).
 * PROMPT 63: pass `options.borrowContext: { durationPlan, currentRole, pipelineKind? }` to borrow 1d from next stage first; on failure returns task unchanged with `extendDenied: true`.
 *
 * @param {object} task
 * @param {string} [defaultUserId]
 * @param {{ borrowContext?: { durationPlan: Record<string, number>, currentRole: string, pipelineKind?: "reel"|"post_like" } }} [options]
 */
function extendDurationTaskByOneDay(task, defaultUserId, options = {}) {
  if (!task || !task.startDate) {
    return task;
  }
  const ctx = options.borrowContext;
  if (ctx?.durationPlan && ctx.currentRole != null) {
    const br = tryBorrowOneDayFromNextStage(
      ctx.currentRole,
      ctx.durationPlan,
      ctx.pipelineKind || "reel"
    );
    if (!br.ok) {
      return { ...task, extendDenied: true, extendDenyReason: br.reason };
    }
  }

  const rule = resolveRule(task.role);
  if (!rule || !rule.flexible) {
    return task;
  }
  const minD = Math.max(1, Number(rule.minDays) || 1);
  const maxD = Math.max(minD, Number(rule.maxDays) || minD);
  const cur = Number(task.durationDays) || 1;
  if (cur >= maxD) {
    return task;
  }

  const nextDur = cur + 1;
  const endDate = addDaysYMD(task.startDate, nextDur - 1);
  const prevEnd = task.endDate || addDaysYMD(task.startDate, cur - 1);
  const prevUser =
    (task.assignedUsersPerDay && task.assignedUsersPerDay[prevEnd]) ||
    defaultUserId ||
    "";
  const assignedUsersPerDay = { ...(task.assignedUsersPerDay || {}) };
  assignedUsersPerDay[endDate] = String(prevUser || "");

  return {
    ...task,
    durationDays: nextDur,
    endDate,
    assignedUsersPerDay,
  };
}

module.exports = {
  normalizeStageToDurationTask,
  normalizeStagesToDurationTasks,
  normalizeDraftItemToDurationTasks,
  extendDurationTaskByOneDay,
  buildAssignedUsersPerDayFromSchedule,
  buildAssignedUsersPerDay,
  toYmd,
  WORKFLOW_ROLE_TO_RULE_KEY,
};
