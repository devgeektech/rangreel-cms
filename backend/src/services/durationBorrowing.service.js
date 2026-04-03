const { ROLE_RULES } = require("../config/roleRules");

/**
 * PROMPT 63 — Map workflowStages[].role → ROLE_RULES key (graphicDesigner has no entry → minDays 1).
 */
const WORKFLOW_TO_RULE_KEY = {
  strategist: "strategist",
  videographer: "shoot",
  videoEditor: "editor",
  graphicDesigner: "graphicDesigner",
  manager: "manager",
  postingExecutive: "post",
};

/** Reel pipeline order (same as simple calendar generation). */
const REEL_PIPELINE = [
  "strategist",
  "videographer",
  "videoEditor",
  "manager",
  "postingExecutive",
];

/** Static post / carousel (design instead of shoot/edit). */
const POST_LIKE_PIPELINE = [
  "strategist",
  "graphicDesigner",
  "manager",
  "postingExecutive",
];

function getMinDaysForWorkflowRole(workflowRole) {
  const key = WORKFLOW_TO_RULE_KEY[workflowRole];
  if (!key || !ROLE_RULES[key]) return 1;
  return Math.max(1, Number(ROLE_RULES[key].minDays) || 1);
}

/**
 * @param {string} currentWorkflowRole
 * @param {"reel"|"post_like"} pipelineKind
 * @returns {string|null}
 */
function getNextWorkflowRole(currentWorkflowRole, pipelineKind = "reel") {
  const chain = pipelineKind === "post_like" ? POST_LIKE_PIPELINE : REEL_PIPELINE;
  const idx = chain.indexOf(currentWorkflowRole);
  if (idx === -1 || idx >= chain.length - 1) return null;
  return chain[idx + 1];
}

/**
 * PROMPT 63 — When extending current stage by +1 day, take 1 day from the next stage’s planned duration.
 * Mutates `durationPlan[nextRole]` on success.
 *
 * Rules: next stage >= minDays after −1; cannot reduce strategist; cannot reduce posting (postingExecutive).
 *
 * @param {string} currentWorkflowRole — stage being extended (e.g. videographer)
 * @param {Record<string, number>} durationPlan — planned duration days per workflow role
 * @param {"reel"|"post_like"} pipelineKind
 * @returns {{ ok: true, nextRole: string, newDuration: number } | { ok: false, reason: string }}
 */
function tryBorrowOneDayFromNextStage(currentWorkflowRole, durationPlan, pipelineKind = "reel") {
  const nextRole = getNextWorkflowRole(currentWorkflowRole, pipelineKind);
  if (!nextRole) {
    return { ok: false, reason: "no_next_stage" };
  }
  if (nextRole === "strategist") {
    return { ok: false, reason: "cannot_reduce_strategist" };
  }
  if (nextRole === "postingExecutive") {
    return { ok: false, reason: "cannot_reduce_post" };
  }

  const minDays = getMinDaysForWorkflowRole(nextRole);
  const cur = durationPlan[nextRole];
  if (cur == null || !Number.isFinite(Number(cur))) {
    return { ok: false, reason: "missing_duration" };
  }
  const nextVal = Number(cur) - 1;
  if (nextVal < minDays) {
    return { ok: false, reason: "below_min_days" };
  }

  durationPlan[nextRole] = nextVal;
  return { ok: true, nextRole, newDuration: nextVal };
}

module.exports = {
  tryBorrowOneDayFromNextStage,
  getNextWorkflowRole,
  getMinDaysForWorkflowRole,
  REEL_PIPELINE,
  POST_LIKE_PIPELINE,
};
