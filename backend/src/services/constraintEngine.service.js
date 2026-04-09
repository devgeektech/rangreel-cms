const mongoose = require("mongoose");
const ContentItem = require("../models/ContentItem");
const TeamCapacity = require("../models/TeamCapacity");
const { countActiveStagesOnDay, resolveRoleCapacity } = require("./capacityAvailability.service");
const { isUserOnLeaveForDay, MAX_REELS_PER_USER } = require("./availability.service");

function toObjectId(userId) {
  if (!userId) return null;
  const id = userId._id || userId;
  const s = String(id);
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

function startOfDayUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Distinct reel content items where user has a non-terminal workflow stage (Prompt 57 cap).
 * @param {import("mongoose").Types.ObjectId|string} userId
 * @param {string|import("mongoose").Types.ObjectId} [excludeContentItemId]
 */
async function countActiveReelItemsForUser(userId, excludeContentItemId) {
  const uid = toObjectId(userId);
  if (!uid) return 0;

  const match = { contentType: "reel" };
  const ex = excludeContentItemId ? toObjectId(excludeContentItemId) : null;
  if (ex) {
    match._id = { $ne: ex };
  }

  const [row] = await ContentItem.aggregate([
    { $match: match },
    { $unwind: "$workflowStages" },
    {
      $match: {
        "workflowStages.assignedUser": uid,
        "workflowStages.status": { $nin: ["completed", "posted"] },
      },
    },
    { $group: { _id: "$_id" } },
    { $count: "n" },
  ]);

  return row?.n ?? 0;
}

function isReelWorkloadTask(task) {
  const ct = task?.contentType ?? task?.type;
  if (ct === "reel") return true;
  if (ct === "post" || ct === "carousel" || ct === "static_post") return false;
  return false;
}

/**
 * PROMPT 59 — Per-day validation: capacity, leave, max reels (reel content only).
 *
 * @param {object} task — Must include `role` (workflow role). Optional: `leaves`, `contentItemId` (exclude from reel count),
 *   `contentType` / `type` (reel vs post for max-reels), `capacityDelta` (e.g. urgent reel).
 * @param {Date|string|number} date — UTC calendar day
 * @param {import("mongoose").Types.ObjectId|string} userId
 * @returns {Promise<{ valid: true } | { valid: false, reason: string }>}
 */
async function validateTaskPerDay(task, date, userId) {
  const role = task?.role;
  if (!role || typeof role !== "string") {
    return { valid: false, reason: "missing_role" };
  }

  const uid = toObjectId(userId);
  if (!uid) {
    return { valid: false, reason: "invalid_user" };
  }

  const dayStart = startOfDayUTC(date);
  if (!dayStart) {
    return { valid: false, reason: "invalid_date" };
  }

  const leaves = Array.isArray(task?.leaves) ? task.leaves : [];
  if (isUserOnLeaveForDay(userId, date, leaves)) {
    return { isValid: false, valid: false, reason: "User is on leave" };
  }

  const capDoc = await TeamCapacity.findOne({ role }).select("dailyCapacity").lean();
  const roleCapacity = resolveRoleCapacity(capDoc);
  const capacityDelta = Number.isFinite(task?.capacityDelta) ? Math.max(0, task.capacityDelta) : 0;
  const threshold = roleCapacity + capacityDelta;

  let used;
  try {
    used = await countActiveStagesOnDay(role, userId, dayStart);
  } catch {
    return { valid: false, reason: "invalid_user" };
  }

  if (used >= threshold) {
    return { valid: false, reason: "capacity" };
  }

  if (isReelWorkloadTask(task)) {
    const reelCount = await countActiveReelItemsForUser(userId, task.contentItemId || task.contentItem);
    if (reelCount >= MAX_REELS_PER_USER) {
      return { valid: false, reason: "max_reels" };
    }
  }

  return { isValid: true, valid: true };
}

module.exports = {
  validateTaskPerDay,
  countActiveReelItemsForUser,
};
