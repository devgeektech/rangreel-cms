/**
 * Shared helpers for role dashboards (my-tasks).
 */

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function toYMDUTC(date) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function getTodayStartUTC() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function getTodayStartMs() {
  return getTodayStartUTC().getTime();
}

export function shiftMonthYYYYMM(monthStr, delta) {
  const m = String(monthStr).match(/^(\d{4})-(\d{2})$/);
  if (!m) return monthStr;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const d = new Date(Date.UTC(year, monthIndex, 1));
  d.setUTCMonth(d.getUTCMonth() + delta);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

export function formatMonthLabelEN(monthStr) {
  const m = String(monthStr).match(/^(\d{4})-(\d{2})$/);
  if (!m) return monthStr;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

/**
 * @param {object} stage
 * @param {"default" | "posting"} kind
 */
export function isWorkflowStageCompleted(stage, kind = "default") {
  const s = String(stage?.status || "").toLowerCase();
  if (kind === "posting") return s === "completed";
  return s === "completed" || s === "approved";
}

/**
 * Overdue: dueDate before start of today (UTC) and status is not submitted/posted (per Prompt 21).
 * Posting role uses the same exemption rule; "completed" UI for posting is only when posted.
 *
 * @param {object} stage
 * @param {number} todayStartMs
 */
export function isWorkflowStageOverdue(stage, todayStartMs) {
  const s = String(stage?.status || "").toLowerCase();
  if (s === "completed" || s === "approved") return false;
  const d = stage?.dueDate ? new Date(stage.dueDate) : null;
  if (!d || Number.isNaN(d.getTime())) return false;
  return d.getTime() < todayStartMs;
}
