const UserCapacity = require("../models/UserCapacity");
const TeamCapacity = require("../models/TeamCapacity");
const {
  ROLE_CAPACITY_MAP,
  normalizeContentTypeForCapacity,
} = require("../constants/roleCapacityMap");

const FIELD_BY_CONTENT_TYPE = {
  reel: "reelCapacity",
  static_post: "postCapacity",
  carousel: "carouselCapacity",
};
const OVERRIDE_FLAG_BY_FIELD = {
  reelCapacity: "overrideReelCapacity",
  postCapacity: "overridePostCapacity",
  carouselCapacity: "overrideCarouselCapacity",
};

function normalizeUserId(userId) {
  if (!userId) return null;
  if (typeof userId === "object") {
    return userId._id || userId.id || null;
  }
  return userId;
}

/**
 * Effective per-day capacity ceiling for (user, workflow role, content type).
 * - User override (>0) wins over global.
 * - Global 0 = unlimited (returns 0; scheduler treats 0 as unlimited via `cap > 0` check).
 * - Role cannot hold content type: returns 0 and caller should use isRoleContentTypeAllowed first,
 *   or we return -1 — here we return 0 for "no valid cap" and validation uses ROLE_CAPACITY_MAP separately.
 *
 * For scheduling: use with `if (cap > 0 && count >= cap)` so 0 = unlimited.
 * Invalid role+type: returns 0 (unlimited) only if allowed; if !allowed, returns -1.
 */
async function getEffectiveCapacity(userId, role, contentType) {
  const ct = normalizeContentTypeForCapacity(contentType);
  if (!ct || !role) return -1;

  const allowed = ROLE_CAPACITY_MAP[role];
  if (!Array.isArray(allowed) || !allowed.includes(ct)) {
    return -1;
  }

  const field = FIELD_BY_CONTENT_TYPE[ct];
  if (!field) return -1;

  const normalizedUserId = normalizeUserId(userId);
  const userCap = normalizedUserId
    ? await UserCapacity.findOne({ user: normalizedUserId }).lean()
    : null;
  const globalCap = await TeamCapacity.findOne({ role }).lean();

  const userHasOverride =
    userCap &&
    (userCap[OVERRIDE_FLAG_BY_FIELD[field]] === true ||
      Number(userCap[field]) > 0);
  if (userHasOverride) {
    const v = Number(userCap[field]);
    return Number.isFinite(v) && v >= 0 ? v : 0;
  }

  const g = globalCap && Number.isFinite(Number(globalCap[field])) ? Number(globalCap[field]) : 0;
  return g;
}

module.exports = {
  getEffectiveCapacity,
  FIELD_BY_CONTENT_TYPE,
};
