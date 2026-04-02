const User = require("../models/User");
const Role = require("../models/Role");

/** Max concurrent reel workloads per user (Prompt 57). */
const MAX_REELS_PER_USER = 2;

/**
 * Role rule keys (roleRules) → Role.slug in DB.
 */
const ROLE_KEY_TO_SLUG = {
  strategist: "strategist",
  shoot: "videographer",
  editor: "editor",
  manager: "manager",
  post: "posting",
};

/**
 * Role rule keys → ContentItem.workflowStages[].role strings.
 */
const ROLE_KEY_TO_WORKFLOW_ROLE = {
  strategist: "strategist",
  shoot: "videographer",
  editor: "videoEditor",
  manager: "manager",
  post: "postingExecutive",
};

/** Accept workflow strings or rule keys when calling getAvailableUsers. */
const ROLE_INPUT_ALIASES = {
  strategist: "strategist",
  shoot: "shoot",
  videographer: "shoot",
  editor: "editor",
  videoEditor: "editor",
  manager: "manager",
  post: "post",
  postingExecutive: "post",
  posting: "post",
};

function startOfDayUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid date");
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDaysUTC(d, days) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function toYMDUTC(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

function toIdString(userId) {
  if (!userId) return "";
  const id = userId._id || userId;
  return String(id);
}

function normalizeRoleKey(role) {
  if (role == null || typeof role !== "string") return null;
  const k = role.trim();
  return ROLE_INPUT_ALIASES[k] || (ROLE_KEY_TO_SLUG[k] ? k : null);
}

/**
 * Expand tasks to stage-level rows. Supports flat stage rows or ContentItem-shaped docs with workflowStages.
 */
function flattenTasks(tasks) {
  if (!Array.isArray(tasks)) return [];
  const out = [];
  for (const t of tasks) {
    if (t && Array.isArray(t.workflowStages)) {
      const contentType = t.contentType || t.type;
      const contentItemId = t._id;
      for (const ws of t.workflowStages) {
        if (!ws) continue;
        out.push({
          ...ws,
          contentType: ws.contentType || contentType,
          contentItemId,
        });
      }
    } else if (t) {
      out.push(t);
    }
  }
  return out;
}

function isReelTask(row) {
  const ct = row.contentType || row.type;
  return ct === "reel";
}

function isTerminalStageStatus(status) {
  return status === "completed" || status === "posted";
}

function isSameUtcDay(dueDate, dayStartUTC) {
  if (!dueDate) return false;
  const d = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(d.getTime())) return false;
  const dayEnd = addDaysUTC(dayStartUTC, 1);
  return d >= dayStartUTC && d < dayEnd;
}

/**
 * Active reel count: distinct content items (or rows if no id) with non-terminal stage for this user.
 */
function countActiveReelsForUser(userIdStr, flatTasks) {
  const seen = new Set();
  for (const row of flatTasks) {
    if (!isReelTask(row)) continue;
    if (toIdString(row.assignedUser) !== userIdStr) continue;
    if (isTerminalStageStatus(row.status)) continue;
    const key = row.contentItemId ? String(row.contentItemId) : `${toIdString(row.assignedUser)}-${row.role}-${row.dueDate}`;
    seen.add(key);
  }
  return seen.size;
}

function hasSameDayAssignment(userIdStr, dayStartUTC, workflowRole, flatTasks) {
  for (const row of flatTasks) {
    if (toIdString(row.assignedUser) !== userIdStr) continue;
    if (row.role !== workflowRole) continue;
    if (isTerminalStageStatus(row.status)) continue;
    if (isSameUtcDay(row.dueDate, dayStartUTC)) return true;
  }
  return false;
}

function parseYMD(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function isUserOnLeave(userIdStr, dateYMD, dayStartUTC, leaves) {
  if (!Array.isArray(leaves) || leaves.length === 0) return false;
  for (const L of leaves) {
    if (!L) continue;
    const uid = toIdString(L.userId || L.user || L.assignedUser);
    if (uid !== userIdStr) continue;

    if (L.date != null) {
      const d = L.date instanceof Date ? L.date : parseYMD(L.date);
      if (d && !Number.isNaN(d.getTime()) && toYMDUTC(startOfDayUTC(d)) === dateYMD) {
        return true;
      }
    }
    // PROMPT 77: Leave model uses inclusive UTC range:
    // startDate <= date <= endDate
    if (L.startDate != null && L.endDate != null) {
      const from = L.startDate instanceof Date ? L.startDate : parseYMD(L.startDate);
      const to = L.endDate instanceof Date ? L.endDate : parseYMD(L.endDate);
      if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) continue;
      const fromDay = startOfDayUTC(from);
      const toDay = startOfDayUTC(to);
      if (dayStartUTC >= fromDay && dayStartUTC <= toDay) return true;
    }
    if (L.from != null && L.to != null) {
      const from = L.from instanceof Date ? L.from : parseYMD(L.from);
      const to = L.to instanceof Date ? L.to : parseYMD(L.to);
      if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) continue;
      const fromDay = startOfDayUTC(from);
      const toDay = startOfDayUTC(to);
      if (dayStartUTC >= fromDay && dayStartUTC <= toDay) return true;
    }
  }
  return false;
}

/**
 * PROMPT 57 — Users available for a role on a date: not on leave, no same-day assignment for that
 * workflow role, and under the max concurrent reel load (2).
 *
 * @param {string} role — Rule key (e.g. shoot) or workflow role (e.g. videographer)
 * @param {Date|string|number} date — Calendar day (interpreted in UTC)
 * @param {Array<object>} [tasks] — Flat stage rows and/or ContentItems with workflowStages
 * @param {Array<{ userId?: object, user?: object, date?: string|Date, from?: string|Date, to?: string|Date }>} [leaves]
 * @returns {Promise<Array<object>>} Lean user docs with populated role
 */
async function getAvailableUsers(role, date, tasks = [], leaves = []) {
  const roleKey = normalizeRoleKey(role);
  if (!roleKey) {
    throw new Error(`Unknown role: ${role}`);
  }

  const slug = ROLE_KEY_TO_SLUG[roleKey];
  const workflowRole = ROLE_KEY_TO_WORKFLOW_ROLE[roleKey];

  const roleDoc = await Role.findOne({ slug, isActive: true }).select("_id").lean();
  if (!roleDoc) {
    return [];
  }

  const users = await User.find({ role: roleDoc._id, isActive: true })
    .select("name email role")
    .populate("role", "slug name")
    .lean();

  const dayStart = startOfDayUTC(date);
  const dateYMD = toYMDUTC(dayStart);
  const flatTasks = flattenTasks(tasks);

  return users.filter((u) => {
    const idStr = String(u._id);
    if (isUserOnLeave(idStr, dateYMD, dayStart, leaves)) return false;
    if (hasSameDayAssignment(idStr, dayStart, workflowRole, flatTasks)) return false;
    if (countActiveReelsForUser(idStr, flatTasks) >= MAX_REELS_PER_USER) return false;
    return true;
  });
}

/**
 * @param {import("mongoose").Types.ObjectId|string} userId
 * @param {Date|string|number} date
 * @param {Array<{ userId?: object, user?: object, date?: string|Date, from?: string|Date, to?: string|Date }>} [leaves]
 * @returns {boolean} true if user is on leave that UTC calendar day
 */
function isUserOnLeaveForDay(userId, date, leaves = []) {
  const dayStart = startOfDayUTC(date);
  const dateYMD = toYMDUTC(dayStart);
  return isUserOnLeave(toIdString(userId), dateYMD, dayStart, leaves);
}

module.exports = {
  getAvailableUsers,
  isUserOnLeaveForDay,
  MAX_REELS_PER_USER,
  ROLE_KEY_TO_SLUG,
  ROLE_KEY_TO_WORKFLOW_ROLE,
};
