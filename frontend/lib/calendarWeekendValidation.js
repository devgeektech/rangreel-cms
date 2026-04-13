import { addDaysToYmd } from "@/lib/calendarDraftUtils";

/**
 * @param {string} ymd - YYYY-MM-DD (UTC calendar day)
 * @returns {number} 0 = Sun … 6 = Sat
 */
export function getDayUTC(ymd) {
  const s = String(ymd || "").slice(0, 10);
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return -1;
  return d.getUTCDay();
}

function isWeekendYmd(ymd) {
  const day = getDayUTC(ymd);
  return day === 0 || day === 6;
}

/**
 * @param {string|Date} targetDate - YYYY-MM-DD or Date
 * @param {{ weekendEnabled?: boolean }} clientSettings
 * @returns {true | "WEEKEND_BLOCKED"}
 */
export function validateWeekendMove(targetDate, clientSettings) {
  if (clientSettings?.weekendEnabled) return true;
  const ymd =
    targetDate instanceof Date
      ? `${targetDate.getUTCFullYear()}-${String(targetDate.getUTCMonth() + 1).padStart(2, "0")}-${String(targetDate.getUTCDate()).padStart(2, "0")}`
      : String(targetDate).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return true;
  const day = getDayUTC(ymd);
  if (day === 0 || day === 6) return "WEEKEND_BLOCKED";
  return true;
}

/**
 * Inclusive range [startYmd, endYmd] by UTC calendar day.
 * @returns {true | "WEEKEND_BLOCKED"}
 */
export function validateMultiDayTask(startYmd, endYmd, clientSettings) {
  if (clientSettings?.weekendEnabled) return true;
  let cur = String(startYmd || "").slice(0, 10);
  const end = String(endYmd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cur) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return true;
  if (cur > end) return true;

  for (let guard = 0; guard < 400; guard += 1) {
    const res = validateWeekendMove(cur, clientSettings);
    if (res === "WEEKEND_BLOCKED") return res;
    if (cur === end) break;
    cur = addDaysToYmd(cur, 1);
  }
  return true;
}

/**
 * After a preview draft (e.g. with weekend moves allowed), detect if any stage date falls on Sat/Sun.
 * Used when client has weekend OFF but user may confirm a one-time weekend placement.
 */
export function draftItemTouchesWeekend(draft, contentId) {
  const item = (draft?.items || []).find((it) => String(it.contentId) === String(contentId));
  if (!item) return false;
  for (const s of item.stages || []) {
    const ymd = String(s?.date || "").slice(0, 10);
    if (ymd && isWeekendYmd(ymd)) return true;
  }
  return false;
}

function mapStagesByName(item) {
  const m = new Map();
  for (const s of item?.stages || []) {
    const name = String(s?.name || "");
    if (!name) continue;
    m.set(name, String(s?.date || "").slice(0, 10));
  }
  return m;
}

function movedStagesIntroduceWeekend(beforeDraft, afterDraft, contentId) {
  const beforeItem = (beforeDraft?.items || []).find((it) => String(it.contentId) === String(contentId));
  const afterItem = (afterDraft?.items || []).find((it) => String(it.contentId) === String(contentId));
  if (!afterItem) return false;
  const beforeMap = mapStagesByName(beforeItem);
  const afterMap = mapStagesByName(afterItem);
  for (const [stageName, afterYmd] of afterMap.entries()) {
    const beforeYmd = beforeMap.get(stageName) || "";
    if (afterYmd !== beforeYmd && afterYmd && isWeekendYmd(afterYmd)) {
      return true;
    }
  }
  return false;
}

export function getStageDurationDaysFromSchedule(schedule, contentId, stageName) {
  const item = (schedule?.items || []).find((it) => String(it.contentId) === String(contentId));
  const stage = (item?.stages || []).find((s) => String(s?.name) === String(stageName));
  const n = Number(stage?.durationDays);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/**
 * Decide if a move needs weekend confirmation, hard-block, or can proceed.
 * @param {object} params
 * @returns {{ kind: "proceed" } | { kind: "hard_block" } | { kind: "confirm" } | { kind: "error", message: string }}
 */
export function classifyWeekendStageMove(params) {
  const {
    schedule,
    contentId,
    stageName,
    newYmd,
    weekendMode,
    useWeekendConfirm,
    isCustomizationMode,
    customizationOpts,
    applyCustomizationDrag: applyCust,
    applyManagerEditDrag: applyMgr,
  } = params;

  if (weekendMode) return { kind: "proceed" };

  if (!useWeekendConfirm) {
    const v = validateWeekendMove(newYmd, { weekendEnabled: false });
    if (v === "WEEKEND_BLOCKED") return { kind: "hard_block" };
    return { kind: "proceed" };
  }

  if (isCustomizationMode) {
    const moved = applyCust(schedule, contentId, stageName, newYmd, {
      ...customizationOpts,
      weekendEnabled: true,
    });
    if (moved.blocked) return { kind: "error", message: moved.reason || "Invalid move" };
    if (movedStagesIntroduceWeekend(schedule, moved.draft, contentId)) return { kind: "confirm" };
    return { kind: "proceed" };
  }

  const moved = applyMgr(schedule, contentId, stageName, newYmd);
  if (moved.blocked) return { kind: "error", message: moved.reason || "Invalid move" };

  const dur = getStageDurationDaysFromSchedule(schedule, contentId, stageName);
  const endYmd = addDaysToYmd(newYmd, dur - 1);
  const rangeRes = validateMultiDayTask(newYmd, endYmd, { weekendEnabled: false });
  if (rangeRes === "WEEKEND_BLOCKED") return { kind: "confirm" };

  return { kind: "proceed" };
}
