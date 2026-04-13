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

  const userCap = await UserCapacity.findOne({ user: userId }).lean();
  const globalCap = await TeamCapacity.findOne({ role }).lean();

  if (userCap && Number(userCap[field]) > 0) {
    return Number(userCap[field]);
  }

  const g = globalCap && Number.isFinite(Number(globalCap[field])) ? Number(globalCap[field]) : 0;
  return g;
}

module.exports = {
  getEffectiveCapacity,
  FIELD_BY_CONTENT_TYPE,
};
