const mongoose = require("mongoose");
const ContentItem = require("../models/ContentItem");
const TeamCapacity = require("../models/TeamCapacity");
const {
  countActiveStagesOnDay,
  DEFAULT_DAILY_CAPACITY,
} = require("./capacityAvailability.service");

function startOfDayUTC(ymd) {
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function toObjectId(id) {
  if (!id) return null;
  const raw = id._id || id;
  const s = String(raw);
  if (!mongoose.Types.ObjectId.isValid(s)) return null;
  return new mongoose.Types.ObjectId(s);
}

function addDaysUTC(d, days) {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

async function resolveRoleCapacity(role) {
  const capDoc = await TeamCapacity.findOne({ role }).select("dailyCapacity").lean();
  if (capDoc && Number.isFinite(capDoc.dailyCapacity) && capDoc.dailyCapacity >= 0) {
    return capDoc.dailyCapacity;
  }
  return DEFAULT_DAILY_CAPACITY;
}

/**
 * Active workflow stages for one client on a UTC calendar day (same rules as global count).
 */
async function countClientStagesOnDay(clientId, role, userId, dayStartUTC) {
  const uid = toObjectId(userId);
  const cid = toObjectId(clientId);
  if (!uid || !cid) return 0;

  const dayEnd = addDaysUTC(dayStartUTC, 1);

  const [row] = await ContentItem.aggregate([
    { $match: { client: cid } },
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

function extractAssignedUserId(assignedUser) {
  if (!assignedUser) return null;
  if (typeof assignedUser === "object" && assignedUser._id) {
    return String(assignedUser._id);
  }
  return String(assignedUser);
}

/**
 * Aggregate proposed draft stages: one row per (userId, role, ymd).
 */
function flattenProposedStages(items) {
  const map = new Map();
  for (const item of items || []) {
    for (const s of item.stages || []) {
      const uid = extractAssignedUserId(s.assignedUser);
      if (!uid || !s.role || !s.date) continue;
      const ymd = String(s.date).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
      const key = `${uid}|${s.role}|${ymd}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
  }
  return map;
}

/**
 * Effective load for one (user, role, day): DB total minus this client's current load plus proposed.
 *
 * @param {string} clientId
 * @param {Map<string, number>} proposedMap - keys `${userId}|${role}|${ymd}`
 * @returns {Promise<{ warnings: object[], byDay: Record<string, object[]> }>}
 */
async function detectCapacityConflicts(clientId, items) {
  const proposedMap = flattenProposedStages(items);
  const entries = [...proposedMap.entries()];

  const evaluated = await Promise.all(
    entries.map(async ([key, proposedCount]) => {
      const [userId, role, ymd] = key.split("|");
      const dayStart = startOfDayUTC(ymd);
      if (!dayStart) return null;

      const [totalDb, clientDb, capacity] = await Promise.all([
        countActiveStagesOnDay(role, userId, dayStart),
        countClientStagesOnDay(clientId, role, userId, dayStart),
        resolveRoleCapacity(role),
      ]);

      const effective = totalDb - clientDb + proposedCount;
      if (effective < capacity) return null;

      return {
        userId,
        role,
        date: ymd,
        effectiveCount: effective,
        capacity,
        proposedCount,
        message: `${role} on ${ymd}: ${effective} active tasks vs daily capacity ${capacity} (warn only)`,
      };
    })
  );

  const warnings = evaluated.filter(Boolean);
  const byDay = {};
  for (const w of warnings) {
    if (!byDay[w.date]) byDay[w.date] = [];
    byDay[w.date].push(w);
  }

  return { warnings, byDay };
}

module.exports = {
  detectCapacityConflicts,
};
