const Role = require("../models/Role");
const User = require("../models/User");

const WORKING_DAYS = 22;
const REEL_PIPELINE = 11;
const DESIGN_PIPELINE = 7;
const BUFFER = 0.8;

async function countActiveUsersByRoleSlugs(slugs) {
  const roleDocs = await Role.find({
    slug: { $in: slugs },
    isActive: { $ne: false },
  })
    .select("_id")
    .lean();
  const roleIds = (roleDocs || []).map((r) => r._id);
  if (!roleIds.length) return 0;
  return User.countDocuments({
    role: { $in: roleIds },
    roleType: "user",
    isActive: { $ne: false },
  });
}

async function calculatePackageLimits() {
  const videographers = await countActiveUsersByRoleSlugs(["videographer"]);
  const editors = await countActiveUsersByRoleSlugs([
    "editor",
    "video-editor",
    "videoeditor",
  ]);
  const designers = await countActiveUsersByRoleSlugs([
    "designer",
    "graphic-designer",
    "graphicdesigner",
  ]);
  const postingExecutives = await countActiveUsersByRoleSlugs([
    "posting",
    "posting-executive",
    "postingexecutive",
  ]);

  const reelCapacityPerDay = Math.min(videographers, editors);
  const postCapacityPerDay = postingExecutives;
  const designCapacityPerDay = designers;

  const reelStartWindow = WORKING_DAYS - REEL_PIPELINE;
  const designStartWindow = WORKING_DAYS - DESIGN_PIPELINE;

  const maxReels = Math.floor(reelStartWindow * reelCapacityPerDay * BUFFER);
  const maxPosts = Math.floor(designStartWindow * postCapacityPerDay * BUFFER);
  const maxCarousels = Math.floor(designStartWindow * designCapacityPerDay * BUFFER);
  // Backward-compatible aggregate design cap (legacy callers).
  const maxDesign = maxPosts;

  return { maxReels, maxPosts, maxCarousels, maxDesign };
}

module.exports = {
  calculatePackageLimits,
};

