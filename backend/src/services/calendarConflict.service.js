const mongoose = require("mongoose");
const ContentItem = require("../models/ContentItem");
const {
  countActiveStagesOnDay,
  computeThresholdForUser,
} = require("./capacityAvailability.service");
const { normalizeContentTypeForCapacity } = require("../constants/roleCapacityMap");

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

function resolveItemContentType(item) {
  const t = item?.type || item?.contentType;
  return normalizeContentTypeForCapacity(t) || "reel";
}

/**
 * Active workflow stages for one client on a UTC calendar day (same rules as global count).
 */
async function countClientStagesOnDay(clientId, role, userId, dayStartUTC, contentType) {
  const uid = toObjectId(userId);
  const cid = toObjectId(clientId);
  if (!uid || !cid) return 0;

  const dayEnd = addDaysUTC(dayStartUTC, 1);

  const ct = normalizeContentTypeForCapacity(contentType) || "reel";
  const match = { client: cid };
  if (ct === "reel") match.contentType = { $in: ["reel"] };
  else if (ct === "carousel") match.contentType = { $in: ["carousel"] };
  else match.contentType = { $in: ["static_post", "gmb_post", "campaign"] };

  const [row] = await ContentItem.aggregate([
    { $match: match },
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
 * Aggregate proposed draft stages: one row per (userId, role, ymd, contentType).
 */
function flattenProposedStages(items) {
  const map = new Map();
  for (const item of items || []) {
    const itemCt = resolveItemContentType(item);
    for (const s of item.stages || []) {
      const uid = extractAssignedUserId(s.assignedUser);
      if (!uid || !s.role || !s.date) continue;
      const ymd = String(s.date).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) continue;
      const key = `${uid}|${s.role}|${ymd}|${itemCt}`;
      map.set(key, (map.get(key) || 0) + 1);
    }
  }
  return map;
}

/**
 * @param {string} clientId
 * @param {Map<string, number>} proposedMap - keys `${userId}|${role}|${ymd}|${contentType}`
 */
async function detectCapacityConflicts(clientId, items) {
  const proposedMap = flattenProposedStages(items);
  const entries = [...proposedMap.entries()];

  const evaluated = await Promise.all(
    entries.map(async ([key, proposedCount]) => {
      const [userId, role, ymd, itemCt] = key.split("|");
      const dayStart = startOfDayUTC(ymd);
      if (!dayStart) return null;

      const uid = toObjectId(userId);
      if (!uid) return null;

      const threshold = await computeThresholdForUser(uid, role, itemCt, {
        capacityDelta: 0,
        flexThresholdBoost: 0,
      });

      const [totalDb, clientDb] = await Promise.all([
        countActiveStagesOnDay(role, userId, dayStart, { contentType: itemCt, contentTypeForTasks: itemCt }),
        countClientStagesOnDay(clientId, role, userId, dayStart, itemCt),
      ]);

      const effective = totalDb - clientDb + proposedCount;
      if (effective < threshold) return null;

      return {
        userId,
        role,
        date: ymd,
        effectiveCount: effective,
        capacity: threshold === Number.POSITIVE_INFINITY ? 0 : threshold,
        proposedCount,
        message: `${role} on ${ymd}: ${effective} active tasks vs daily capacity (${
          threshold === Number.POSITIVE_INFINITY ? "unlimited" : threshold
        }) (warn only)`,
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
