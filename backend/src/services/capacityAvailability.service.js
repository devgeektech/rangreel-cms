const mongoose = require("mongoose");
const ContentItem = require("../models/ContentItem");
const TeamCapacity = require("../models/TeamCapacity");

/** Prompt 51: max forward search; prevents infinite loops when permanently overloaded. */
const MAX_SEARCH_DAYS = 365;

/** Prompt 51: when no TeamCapacity row or invalid value, treat cap as 5. */
const DEFAULT_DAILY_CAPACITY = 5;

function startOfDayUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    throw new Error("Invalid startDate");
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

function toObjectId(userId) {
  if (!userId) return null;
  const id = userId._id || userId;
  const s = String(id);
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

function resolveRoleCapacity(capDoc) {
  if (
    capDoc &&
    Number.isFinite(capDoc.dailyCapacity) &&
    capDoc.dailyCapacity >= 0
  ) {
    return capDoc.dailyCapacity;
  }
  return DEFAULT_DAILY_CAPACITY;
}

/**
 * Count workflow stages for this user + role on the given UTC calendar day.
 * Prompt 49: scans ALL content items — no clientId filter — so one editor on five clients still shares one daily cap.
 * Only stages with status !== "completed" are counted.
 */
async function countActiveStagesOnDay(role, userId, dayStartUTC) {
  const uid = toObjectId(userId);
  if (!uid) {
    throw new Error("Invalid assignedUser");
  }
  const dayEnd = addDaysUTC(dayStartUTC, 1);

  const [row] = await ContentItem.aggregate([
    { $match: {} },
    { $unwind: "$workflowStages" },
    {
      $match: {
        "workflowStages.role": role,
        "workflowStages.assignedUser": uid,
        "workflowStages.dueDate": { $gte: dayStartUTC, $lt: dayEnd },
        "workflowStages.status": { $ne: "completed" },
      },
    },
    { $count: "n" },
  ]);

  return row?.n ?? 0;
}

/**
 * First UTC calendar day on or after startDate where active stage count for user+role is below capacity.
 * Counts workload from every client (multi-client safe).
 *
 * Prompt 51: default capacity 5 if unconfigured; max 365-day search; if still overloaded, returns fallback
 * date and logs a warning instead of throwing.
 *
 * @param {string} role
 * @param {import("mongoose").Types.ObjectId|string} assignedUser
 * @param {Date|string|number} startDate
 * @returns {Promise<Date>} UTC midnight
 */
async function getNextAvailableDate(role, assignedUser, startDate, options = {}) {
  if (!role || typeof role !== "string") {
    throw new Error("role is required");
  }

  const capDoc = await TeamCapacity.findOne({ role }).select("dailyCapacity").lean();
  const roleCapacity = resolveRoleCapacity(capDoc);
  const capacityDelta = Number.isFinite(options?.capacityDelta)
    ? options.capacityDelta
    : 0;
  const threshold = roleCapacity + Math.max(0, capacityDelta);

  let d = startOfDayUTC(startDate);

  for (let i = 0; i < MAX_SEARCH_DAYS; i++) {
    const count = await countActiveStagesOnDay(role, assignedUser, d);
    if (count < threshold) {
      return d;
    }
    d = addDaysUTC(d, 1);
  }

  console.warn(
    "[capacity] search window exceeded — using fallback day (may exceed daily cap)",
    JSON.stringify({
      role,
      userId: String(toObjectId(assignedUser)),
      maxSearchDays: MAX_SEARCH_DAYS,
      fallbackDate: d.toISOString().slice(0, 10),
      capacity: roleCapacity,
      usingDefaultCapacity:
        !capDoc || !Number.isFinite(capDoc.dailyCapacity),
    })
  );

  return d;
}

/**
 * Prompt 76: suggest up to 3 fallback dates within the next 7 days.
 * - If requestedDate has capacity, return [requestedDate]
 * - Else, scan requestedDate+1 ... requestedDate+7 and collect available days.
 *
 * @param {string} role
 * @param {import("mongoose").Types.ObjectId|string} userId
 * @param {Date|string|number} requestedDate
 * @returns {Promise<string[]>} YYYY-MM-DD suggestions
 */
async function suggestNextAvailableSlots(role, userId, requestedDate, options = {}) {
  if (!role || typeof role !== "string") {
    throw new Error("role is required");
  }
  const uid = toObjectId(userId);
  if (!uid) {
    throw new Error("Invalid assignedUser");
  }

  const capDoc = await TeamCapacity.findOne({ role }).select("dailyCapacity").lean();
  const roleCapacity = resolveRoleCapacity(capDoc);
  const capacityDelta = Number.isFinite(options?.capacityDelta)
    ? options.capacityDelta
    : 0;
  const threshold = roleCapacity + Math.max(0, capacityDelta);
  const requested = startOfDayUTC(requestedDate);

  const requestedCount = await countActiveStagesOnDay(role, uid, requested);
  if (requestedCount < threshold) {
    return [toYMDUTC(requested)];
  }

  const candidates = [];
  for (let i = 1; i <= 7; i++) {
    const nextDate = addDaysUTC(requested, i);
    const count = await countActiveStagesOnDay(role, uid, nextDate);
    if (count < threshold) {
      candidates.push({ date: nextDate, count, offset: i });
    }
  }

  // Prompt 80: sort by closest date first (offset asc), then least load (count asc).
  candidates.sort((a, b) => {
    if (a.offset !== b.offset) return a.offset - b.offset;
    return a.count - b.count;
  });

  return candidates.slice(0, 3).map((c) => toYMDUTC(c.date));
}

module.exports = {
  getNextAvailableDate,
  suggestNextAvailableSlots,
  countActiveStagesOnDay,
  MAX_SEARCH_DAYS,
  DEFAULT_DAILY_CAPACITY,
};
