const mongoose = require("mongoose");
const ContentItem = require("../models/ContentItem");
const { isUserOnLeaveForDay } = require("./availability.service");
const {
  normalizeContentTypeForCapacity,
} = require("../constants/roleCapacityMap");
const { getEffectiveCapacity } = require("../utils/capacityResolver");

/** Prompt 51: max forward search; prevents infinite loops when permanently overloaded. */
const MAX_SEARCH_DAYS = 365;

function contentTypeInMatch(normalizedCt) {
  if (normalizedCt === "reel") return { $in: ["reel"] };
  if (normalizedCt === "carousel") return { $in: ["carousel"] };
  if (normalizedCt === "static_post") {
    return { $in: ["static_post", "gmb_post", "campaign"] };
  }
  return { $in: [] };
}

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

/**
 * @deprecated Legacy single-field capacity; use getEffectiveCapacity (Prompt 207).
 */
function resolveRoleCapacity(capDoc) {
  if (!capDoc || typeof capDoc !== "object") return 0;
  const a = Number(capDoc.reelCapacity);
  const b = Number(capDoc.postCapacity);
  const c = Number(capDoc.carouselCapacity);
  const nums = [a, b, c].filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length) return Math.max(...nums);
  return 0;
}

async function computeThresholdForUser(userId, role, contentType, options = {}) {
  const ct = normalizeContentTypeForCapacity(contentType);
  if (!ct) return 0;
  const base = await getEffectiveCapacity(userId, role, ct);
  if (base < 0) return 0;
  if (base === 0) return Number.POSITIVE_INFINITY;
  const capacityDelta = Number.isFinite(options?.capacityDelta)
    ? Math.max(0, options.capacityDelta)
    : 0;
  const flex = Number.isFinite(options?.flexThresholdBoost)
    ? Math.max(0, options.flexThresholdBoost)
    : 0;
  return base + capacityDelta + flex;
}

/**
 * Count workflow stages for this user + role + content-type bucket on the given UTC calendar day.
 * Prompt 207: filters by ContentItem.contentType bucket (reel / carousel / static_post family).
 */
async function countActiveStagesOnDay(role, userId, dayStartUTC, options = {}) {
  const uid = toObjectId(userId);
  if (!uid) {
    throw new Error("Invalid assignedUser");
  }
  const normalizedCt =
    normalizeContentTypeForCapacity(options.contentType) ||
    normalizeContentTypeForCapacity(options.contentTypeForTasks);
  if (!normalizedCt) {
    throw new Error("contentType is required for capacity counting");
  }

  const dayEnd = addDaysUTC(dayStartUTC, 1);
  const excludeId = options.excludeContentItemId
    ? toObjectId(options.excludeContentItemId)
    : null;

  const match = { contentType: contentTypeInMatch(normalizedCt) };
  if (excludeId) match._id = { $ne: excludeId };

  const [row] = await ContentItem.aggregate([
    { $match: match },
    { $unwind: "$workflowStages" },
    {
      $match: {
        "workflowStages.role": role,
        "workflowStages.assignedUser": uid,
        "workflowStages.dueDate": { $gte: dayStartUTC, $lt: dayEnd },
        "workflowStages.status": { $nin: ["completed", "posted"] },
      },
    },
    { $count: "n" },
  ]);

  return row?.n ?? 0;
}

async function hasUrgentStageBlockingNormal(role, userId, dayStartUTC, options = {}) {
  const uid = toObjectId(userId);
  if (!uid) return false;
  const normalizedCt =
    normalizeContentTypeForCapacity(options.contentType) ||
    normalizeContentTypeForCapacity(options.contentTypeForTasks) ||
    "reel";
  const dayEnd = addDaysUTC(dayStartUTC, 1);
  const excludeId = options.excludeContentItemId
    ? toObjectId(options.excludeContentItemId)
    : null;

  const match = { contentType: contentTypeInMatch(normalizedCt), planType: "urgent" };
  if (excludeId) match._id = { $ne: excludeId };

  const [row] = await ContentItem.aggregate([
    { $match: match },
    { $unwind: "$workflowStages" },
    {
      $match: {
        "workflowStages.role": role,
        "workflowStages.assignedUser": uid,
        "workflowStages.dueDate": { $gte: dayStartUTC, $lt: dayEnd },
        "workflowStages.status": { $nin: ["completed", "posted"] },
      },
    },
    { $limit: 1 },
    { $count: "n" },
  ]);

  return (row?.n ?? 0) > 0;
}

/**
 * First UTC calendar day on or after startDate where active stage count for user+role+content type is below capacity.
 */
async function getNextAvailableDate(role, assignedUser, startDate, options = {}) {
  if (!role || typeof role !== "string") {
    throw new Error("role is required");
  }

  const contentType =
    options.contentType || options.contentTypeForTasks || "reel";

  const capacityDelta = Number.isFinite(options?.capacityDelta)
    ? options.capacityDelta
    : 0;
  const flexThresholdBoost = Number.isFinite(options?.flexThresholdBoost)
    ? options.flexThresholdBoost
    : 0;
  const leaves = Array.isArray(options?.leaves) ? options.leaves : [];

  let d = startOfDayUTC(startDate);

  const schedulingPlanType = String(options?.schedulingPlanType || "").toLowerCase();

  for (let i = 0; i < MAX_SEARCH_DAYS; i++) {
    if (leaves.length > 0 && isUserOnLeaveForDay(assignedUser, d, leaves)) {
      d = addDaysUTC(d, 1);
      continue;
    }
    if (schedulingPlanType === "normal") {
      const blockedByUrgent = await hasUrgentStageBlockingNormal(role, assignedUser, d, {
        excludeContentItemId: options.excludeContentItemId,
        contentType,
        contentTypeForTasks: contentType,
      });
      if (blockedByUrgent) {
        d = addDaysUTC(d, 1);
        continue;
      }
    }
    const threshold = await computeThresholdForUser(assignedUser, role, contentType, {
      capacityDelta,
      flexThresholdBoost,
    });
    const count = await countActiveStagesOnDay(role, assignedUser, d, {
      excludeContentItemId: options.excludeContentItemId,
      contentType,
      contentTypeForTasks: contentType,
    });
    if (count < threshold) {
      return d;
    }
    d = addDaysUTC(d, 1);
  }

  const baseCap = await getEffectiveCapacity(assignedUser, role, contentType);
  console.warn(
    "[capacity] search window exceeded — using fallback day (may exceed daily cap)",
    JSON.stringify({
      role,
      userId: String(toObjectId(assignedUser)),
      maxSearchDays: MAX_SEARCH_DAYS,
      fallbackDate: d.toISOString().slice(0, 10),
      capacity: baseCap,
    })
  );

  return d;
}

async function suggestNextAvailableSlots(role, userId, requestedDate, options = {}) {
  if (!role || typeof role !== "string") {
    throw new Error("role is required");
  }
  const uid = toObjectId(userId);
  if (!uid) {
    throw new Error("Invalid assignedUser");
  }

  const contentType =
    options.contentType || options.contentTypeForTasks || "reel";

  const capacityDelta = Number.isFinite(options?.capacityDelta)
    ? options.capacityDelta
    : 0;
  const flexThresholdBoost = Number.isFinite(options?.flexThresholdBoost)
    ? options.flexThresholdBoost
    : 0;
  const leaves = Array.isArray(options?.leaves) ? options.leaves : [];
  const schedulingPlanType = String(options?.schedulingPlanType || "").toLowerCase();
  const requested = startOfDayUTC(requestedDate);

  const isDayOpen = async (workday) => {
    if (leaves.length > 0 && isUserOnLeaveForDay(uid, workday, leaves)) return false;
    if (schedulingPlanType === "normal") {
      const blocked = await hasUrgentStageBlockingNormal(role, uid, workday, {
        excludeContentItemId: options.excludeContentItemId,
        contentType,
        contentTypeForTasks: contentType,
      });
      if (blocked) return false;
    }
    const threshold = await computeThresholdForUser(uid, role, contentType, {
      capacityDelta,
      flexThresholdBoost,
    });
    const count = await countActiveStagesOnDay(role, uid, workday, {
      excludeContentItemId: options.excludeContentItemId,
      contentType,
      contentTypeForTasks: contentType,
    });
    return count < threshold;
  };

  if (await isDayOpen(requested)) {
    return [toYMDUTC(requested)];
  }

  const candidates = [];
  for (let i = 1; i <= 7; i++) {
    const nextDate = addDaysUTC(requested, i);
    if (await isDayOpen(nextDate)) {
      const count = await countActiveStagesOnDay(role, uid, nextDate, {
        excludeContentItemId: options.excludeContentItemId,
        contentType,
        contentTypeForTasks: contentType,
      });
      candidates.push({ date: nextDate, count, offset: i });
    }
  }

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
  hasUrgentStageBlockingNormal,
  resolveRoleCapacity,
  computeThresholdForUser,
  MAX_SEARCH_DAYS,
  DEFAULT_DAILY_CAPACITY: 0,
};
