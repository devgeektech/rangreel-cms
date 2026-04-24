/**
 * PROMPT 207 — Strict workflow role → content types allowed for capacity.
 * Keys match ContentItem.workflowStages[].role and TeamCapacity.role.
 */
const ROLE_CAPACITY_MAP = {
  postingExecutive: ["reel", "carousel", "static_post"],
  graphicDesigner: ["static_post", "carousel"],
  videoEditor: ["reel", "carousel", "static_post"],
  videographer: ["reel", "carousel", "static_post"],
  strategist: ["reel", "carousel", "static_post"],
  manager: ["reel", "carousel", "static_post"],
};

/** TeamCapacity / scheduling roles (excludes photographer for capacity rows). */
const TEAM_CAPACITY_ROLES = [
  "strategist",
  "videographer",
  "videoEditor",
  "manager",
  "postingExecutive",
  "graphicDesigner",
];

/**
 * Map Role.slug (User.role ref) → workflow role key used in TeamCapacity / stages.
 */
const ROLE_SLUG_TO_WORKFLOW_ROLE = {
  strategist: "strategist",
  videographer: "videographer",
  editor: "videoEditor",
  designer: "graphicDesigner",
  posting: "postingExecutive",
  manager: "manager",
};

function isRoleContentTypeAllowed(role, contentType) {
  const ct = normalizeContentTypeForCapacity(contentType);
  if (!ct || !role) return false;
  const allowed = ROLE_CAPACITY_MAP[role];
  return Array.isArray(allowed) && allowed.includes(ct);
}

/**
 * Normalize to reel | static_post | carousel for capacity + counting.
 */
function normalizeContentTypeForCapacity(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "reel") return "reel";
  if (s === "carousel") return "carousel";
  if (s === "static_post" || s === "post" || s === "gmb_post" || s === "campaign") {
    return "static_post";
  }
  return null;
}

function resolveWorkflowRoleFromUserRoleSlug(slug) {
  if (!slug || typeof slug !== "string") return null;
  return ROLE_SLUG_TO_WORKFLOW_ROLE[slug] || null;
}

module.exports = {
  ROLE_CAPACITY_MAP,
  TEAM_CAPACITY_ROLES,
  ROLE_SLUG_TO_WORKFLOW_ROLE,
  isRoleContentTypeAllowed,
  normalizeContentTypeForCapacity,
  resolveWorkflowRoleFromUserRoleSlug,
};
