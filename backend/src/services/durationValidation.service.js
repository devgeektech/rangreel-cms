/**
 * PROMPT 108 — Minimum 1 day per stage (editor, manager, videographer, designer, etc.);
 * Post stage is fixed and never donates duration for borrowing.
 */

const { ROLE_RULES } = require("../config/roleRules");

/** workflowStages[].role → ROLE_RULES key (same semantics as taskNormalizer). */
const WORKFLOW_ROLE_TO_RULE_KEY = {
  strategist: "strategist",
  videographer: "shoot",
  videoEditor: "editor",
  graphicDesigner: "graphicDesigner",
  manager: "manager",
  postingExecutive: "post",
};

function resolveWorkflowKey(workflowRole) {
  const r = String(workflowRole || "");
  const lower = r.toLowerCase();
  const alias = {
    videoeditor: "videoEditor",
    postingexecutive: "postingExecutive",
    graphicdesigner: "graphicDesigner",
  };
  const normalized = alias[lower] || r;
  return Object.prototype.hasOwnProperty.call(WORKFLOW_ROLE_TO_RULE_KEY, normalized)
    ? normalized
    : null;
}

/**
 * PROMPT 108 — Each stage keeps at least 1 day; Post stays fixed at 1 day per ROLE_RULES.post.
 *
 * @param {string} workflowRole — e.g. videoEditor, videographer, manager, graphicDesigner
 * @param {number} [override] — requested duration from draft/stage
 * @returns {number} clamped duration days ≥ 1 within [minDays, maxDays]
 */
function clampStageDurationDaysForRole(workflowRole, override) {
  const wf = resolveWorkflowKey(workflowRole);
  if (!wf) {
    if (!Number.isFinite(Number(override))) return 1;
    return Math.max(1, Math.floor(Number(override)));
  }
  const ruleKey = WORKFLOW_ROLE_TO_RULE_KEY[wf];
  const rule = ruleKey ? ROLE_RULES[ruleKey] : null;
  const minD = rule ? Math.max(1, Number(rule.minDays) || 1) : 1;
  const maxD =
    rule && Number.isFinite(Number(rule.maxDays))
      ? Math.max(minD, Number(rule.maxDays))
      : minD;
  if (!Number.isFinite(Number(override))) return minD;
  const n = Math.max(1, Math.floor(Number(override)));
  return Math.min(Math.max(n, minD), maxD);
}

/**
 * Map workflow role string → calendar stage label (for Post exception).
 */
function workflowRoleToStageName(role) {
  const r = String(role || "").toLowerCase();
  if (r === "postingexecutive") return "Post";
  if (r === "videoeditor") return "Edit";
  if (r === "videographer") return "Shoot";
  if (r === "manager") return "Approval";
  if (r === "graphicdesigner") return "Work";
  if (r === "strategist") return "Plan";
  return "";
}

/**
 * PROMPT 108 — Borrow only if next stage has more than 1 day and is not Post (fixed).
 *
 * @param {object} nextTask — supports `duration` or `durationDays`, optional `stage` / `stageName`, `role`
 * @returns {boolean}
 */
function canBorrow(nextTask) {
  if (!nextTask || typeof nextTask !== "object") return false;
  const raw =
    nextTask.duration != null ? nextTask.duration : nextTask.durationDays;
  const d = Number(raw);
  if (!Number.isFinite(d) || d <= 1) return false;

  const stageFromField = String(
    nextTask.stage != null ? nextTask.stage : nextTask.stageName || ""
  ).trim();
  if (stageFromField === "Post") return false;

  const roleStr = String(nextTask.role || "").toLowerCase();
  if (roleStr === "postingexecutive" || roleStr === "post") return false;

  if (workflowRoleToStageName(nextTask.role) === "Post") return false;

  return true;
}

/**
 * Pipeline task shape (`role` + `durationDays`) → borrow allowed?
 */
function canBorrowFromPipelineTask(nextTask) {
  if (!nextTask) return false;
  const d = Number(
    nextTask.durationDays != null ? nextTask.durationDays : nextTask.duration
  );
  const stage =
    (nextTask.stage != null ? nextTask.stage : nextTask.stageName) ||
    workflowRoleToStageName(nextTask.role);
  return canBorrow({
    duration: d,
    durationDays: d,
    stage,
    role: nextTask.role,
  });
}

module.exports = {
  canBorrow,
  canBorrowFromPipelineTask,
  clampStageDurationDaysForRole,
  workflowRoleToStageName,
  WORKFLOW_ROLE_TO_RULE_KEY,
};
