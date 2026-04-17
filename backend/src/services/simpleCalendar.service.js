const Client = require("../models/Client");
const ContentItem = require("../models/ContentItem");
const PublicHoliday = require("../models/PublicHoliday");
const Leave = require("../models/Leave");
const {
  getNextAvailableDate,
  countActiveStagesOnDay,
  computeThresholdForUser,
  MAX_SEARCH_DAYS: CAPACITY_MAX_SEARCH_DAYS,
} = require("./capacityAvailability.service");
const { normalizeContentTypeForCapacity } = require("../constants/roleCapacityMap");
const { getAvailableUsers } = require("./availability.service");
const { ROLE_RULES } = require("../config/roleRules");
const { tryBorrowOneDayFromNextStage } = require("./durationBorrowing.service");
const {
  buildAssignedUsersPerDayFromSchedule,
  normalizeDraftItemToDurationTasks,
} = require("./taskNormalizer.service");
const { buildSortedWorkUnitsClientGeneration } = require("./schedulerPriority.service");
const { getCustomMonthRange } = require("./customMonthRange.service");

/** workflowStages[].role → ROLE_RULES key (Prompt 62). */
const WORKFLOW_ROLE_TO_RULE_KEY = {
  strategist: "strategist",
  videographer: "shoot",
  videoEditor: "editor",
  graphicDesigner: "graphicDesigner",
  manager: "manager",
  postingExecutive: "post",
};

function getDurationExtensionMeta(workflowRole) {
  const key = WORKFLOW_ROLE_TO_RULE_KEY[workflowRole];
  if (!key || !ROLE_RULES[key]) {
    return { flexible: false, maxDays: 1 };
  }
  const r = ROLE_RULES[key];
  const minD = Math.max(1, Number(r.minDays) || 1);
  const maxD = Math.max(minD, Number(r.maxDays) || minD);
  return { flexible: !!r.flexible, maxDays: maxD };
}

// Prompt 34: force date storage as pure UTC midnight.
// YYYY-MM-DD must be parsed as UTC calendar date (local getDate() breaks ISO date strings in US TZs).
function createUTCDate(date) {
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) return null;
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }
  if (typeof date === "string") {
    const t = date.trim();
    const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const day = Number(m[3]);
      if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(day)) return null;
      return new Date(Date.UTC(y, mo - 1, day));
    }
  }
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const addDaysUTC = (date, days) => {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

const toMonthStringUTC = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

const ymdUTC = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

function getMonthKey(date) {
  return new Date(date).toISOString().slice(0, 7); // YYYY-MM
}

const isWeekendUTC = (d) => {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
};

const buildHolidaySetUTC = async (startDate, endDate) => {
  const start = createUTCDate(startDate);
  const end = createUTCDate(endDate);
  if (!start || !end) return new Set();

  const endPlus = addDaysUTC(end, 1);
  const docs = await PublicHoliday.find({ date: { $gte: start, $lt: endPlus } })
    .select("date")
    .lean();

  const set = new Set();
  for (const h of docs) {
    const key = ymdUTC(createUTCDate(h.date));
    if (key) set.add(key);
  }
  return set;
};

/**
 * PROMPT 65: Next schedulable UTC calendar day (holidays always skipped).
 * `allowWeekend` default false — Saturday/Sunday are skipped; if true, weekends are allowed when no weekday is used for that slot.
 */
const nextValidWorkdayUTC = (date, holidaySet, options = {}) => {
  const allowWeekend = options.allowWeekend === true;
  let d = createUTCDate(date);
  if (!d) return null;
  const holidays = holidaySet instanceof Set ? holidaySet : new Set();

  for (let i = 0; i < 370; i++) {
    const key = ymdUTC(d);
    const isHoliday = key && holidays.has(key);
    if (isHoliday) {
      d = addDaysUTC(d, 1);
      continue;
    }
    if (!allowWeekend && isWeekendUTC(d)) {
      d = addDaysUTC(d, 1);
      continue;
    }
    return d;
  }

  return d;
};

function getDaysBetween(start, end) {
  const s = createUTCDate(start);
  const e = createUTCDate(end);
  if (!s || !e) return 0;
  const diff = e.getTime() - s.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;
}

function buildCalendarDays(start, end) {
  const days = [];
  let current = createUTCDate(start);
  const last = createUTCDate(end);
  if (!current || !last) return days;
  while (current.getTime() <= last.getTime()) {
    days.push(createUTCDate(current));
    current = addDaysUTC(current, 1);
  }
  return days;
}

function generateSchedule(totalItems, rangeStart, rangeEnd) {
  const count = Number(totalItems) || 0;
  if (count <= 0) return [];
  const start = createUTCDate(rangeStart);
  if (!start) return [];
  const end = createUTCDate(rangeEnd) || addDaysUTC(start, 27);
  const calendarDays = buildCalendarDays(start, end);
  if (!calendarDays.length) return [];
  const totalDays = getDaysBetween(start, end);
  const gap = Math.max(1, Math.floor(totalDays / count));
  const schedule = [];
  let pointer = 0;
  for (let i = 0; i < count; i += 1) {
    const index = Math.min(pointer, calendarDays.length - 1);
    schedule.push(createUTCDate(calendarDays[index]));
    pointer += gap;
  }
  return schedule;
}

function interleaveContent(reels, posts, carousels) {
  const result = [];
  let i = 0;

  while (i < reels.length || i < posts.length || i < carousels.length) {
    if (reels[i]) result.push({ type: "reel", date: createUTCDate(reels[i]) });
    if (posts[i]) result.push({ type: "post", date: createUTCDate(posts[i]) });
    if (carousels[i]) result.push({ type: "carousel", date: createUTCDate(carousels[i]) });
    i += 1;
  }

  return result;
}

/**
 * Spread strategist anchor dates across the first three custom-month cycles (same anchor as internal calendar).
 * `baseStartDate` is contract start + 1 day (see generateClientReels); we recover start-of-contract for ranges.
 */
function scheduleTypeAcrossThreeMonths(count, baseStartDate, options = {}) {
  if (!Number.isFinite(count) || count <= 0) return [];
  const base = createUTCDate(baseStartDate);
  if (!base) return [];
  const leadBufferDays = Math.max(0, Number(options.leadBufferDays) || 0);
  const monthOffsets =
    Array.isArray(options.monthOffsets) && options.monthOffsets.length
      ? options.monthOffsets.map((x) => Number(x) || 0)
      : [0, 1, 2];
  const clientStart = addDaysUTC(base, -1);
  const ranges = monthOffsets.map((k) => getCustomMonthRange(clientStart, k));
  const result = new Array(count);
  const byMonth = Array.from({ length: ranges.length }, () => []);
  for (let i = 0; i < count; i += 1) {
    byMonth[i % byMonth.length].push(i);
  }
  for (let m = 0; m < byMonth.length; m += 1) {
    const idxs = byMonth[m];
    if (!idxs.length) continue;
    const monthStart = addDaysUTC(ranges[m].start, 1);
    let monthEnd = createUTCDate(ranges[m].end);
    if (leadBufferDays > 0) {
      const capped = addDaysUTC(monthEnd, -leadBufferDays);
      if (capped.getTime() >= monthStart.getTime()) monthEnd = capped;
    }
    const sched = generateSchedule(idxs.length, monthStart, monthEnd);
    for (let j = 0; j < idxs.length; j += 1) {
      result[idxs[j]] = sched[j];
    }
  }
  return result;
}

function buildStrategistStartDates({
  baseStartDate,
  reelsCount,
  postsCount,
  carouselsCount,
  holidaySet,
  monthOffsets,
}) {
  // Keep strategist anchors early enough so downstream stage durations still finish inside each 30-day cycle.
  const reels = scheduleTypeAcrossThreeMonths(reelsCount, baseStartDate, {
    leadBufferDays: 14,
    monthOffsets,
  });
  const posts = scheduleTypeAcrossThreeMonths(postsCount, baseStartDate, {
    leadBufferDays: 8,
    monthOffsets,
  });
  const carousels = scheduleTypeAcrossThreeMonths(carouselsCount, baseStartDate, {
    leadBufferDays: 8,
    monthOffsets,
  });
  const finalSchedule = interleaveContent(reels, posts, carousels);

  const usedDates = new Set();
  const byType = { reel: [], post: [], carousel: [] };

  const avoidSameDay = (date) => {
    let d = createUTCDate(date);
    while (usedDates.has(ymdUTC(d))) {
      d = addDaysUTC(d, 1);
      d = nextValidWorkdayUTC(d, holidaySet, { allowWeekend: false });
    }
    usedDates.add(ymdUTC(d));
    return d;
  };

  for (const entry of finalSchedule) {
    const safeDate = nextValidWorkdayUTC(entry.date, holidaySet, { allowWeekend: false });
    byType[entry.type].push(avoidSameDay(safeDate));
  }

  return byType;
}

const mapLegacyFlatTeamToTyped = (team) => {
  const flat = team || {};
  const reels = {
    strategist: flat.strategist,
    videographer: flat.videographer,
    videoEditor: flat.videoEditor,
    manager: flat.manager,
    postingExecutive: flat.postingExecutive,
  };
  const posts = {
    strategist: flat.strategist,
    graphicDesigner: flat.graphicDesigner,
    manager: flat.manager,
    postingExecutive: flat.postingExecutive,
  };
  const carousel = {
    strategist: flat.strategist,
    graphicDesigner: flat.graphicDesigner,
    manager: flat.manager,
    postingExecutive: flat.postingExecutive,
  };
  return { reels, posts, carousel };
};

const getTeamForContentType = (team, type) => {
  const src = team || {};
  const hasTypedTeam = Boolean(src.reels || src.posts || src.carousel);
  const typed = hasTypedTeam ? src : mapLegacyFlatTeamToTyped(src);
  if (type === "reel") return typed.reels || {};
  if (type === "post") return typed.posts || {};
  if (type === "carousel") return typed.carousel || {};
  return {};
};

/**
 * Next valid workday for role/user at or after fromDate, respecting global capacity + weekends/holidays.
 * Prompt 51: bounded alignment loop; warn and return best workday instead of throwing.
 */
async function scheduleStageDay(role, userId, fromDate, holidaySet, schedulingOptions = {}) {
  const dayOpts = { allowWeekend: schedulingOptions.allowWeekend === true };
  const flexCapDelta = schedulingOptions.allowFlexibleAdjustment === true ? 1 : 0;
  const contentType =
    schedulingOptions.contentType || schedulingOptions.contentTypeForTasks || "reel";
  let anchor = createUTCDate(nextValidWorkdayUTC(fromDate, holidaySet, dayOpts));
  if (!anchor) throw new Error("Invalid anchor date");
  if (!userId) return anchor;

  const maxAlign = Math.min(370, CAPACITY_MAX_SEARCH_DAYS + 5);

  for (let iter = 0; iter < maxAlign; iter++) {
    const raw = await getNextAvailableDate(role, userId, anchor, {
      capacityDelta: flexCapDelta,
      excludeContentItemId: schedulingOptions.excludeContentItemId,
      leaves: schedulingOptions.leaves,
      schedulingPlanType: schedulingOptions.schedulingPlanType,
      contentType,
      contentTypeForTasks: contentType,
    });
    const d = createUTCDate(raw);
    const aligned = createUTCDate(nextValidWorkdayUTC(d, holidaySet, dayOpts));
    if (!aligned) {
      console.warn("[simpleCalendar] scheduleStageDay: could not align workday, using anchor", {
        role,
        iter,
      });
      return anchor;
    }
    if (aligned.getTime() === d.getTime()) return d;
    anchor = aligned;
  }

  console.warn("[simpleCalendar] scheduleStageDay: alignment iterations exceeded", {
    role,
    userId: String(userId),
    maxAlign,
  });
  return createUTCDate(nextValidWorkdayUTC(anchor, holidaySet, dayOpts)) || anchor;
}

function isSameUtcDay(dueDate, dayStartUTC) {
  const d = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(d.getTime())) return false;
  const dayEnd = addDaysUTC(dayStartUTC, 1);
  return d >= dayStartUTC && d < dayEnd;
}

/**
 * DB workload plus in-buffer synthetic rows for the same UTC day (Prompt 61).
 */
async function countStagesForUserDay(
  workflowRole,
  userId,
  workday,
  pendingSynthetic,
  countOptions = {}
) {
  const uid = userId?._id || userId;
  if (!uid) return 0;
  const ctNorm =
    normalizeContentTypeForCapacity(countOptions.contentType || countOptions.contentTypeForTasks) ||
    "reel";
  const db = await countActiveStagesOnDay(workflowRole, uid, workday, countOptions);
  const dayStart = createUTCDate(workday);
  if (!dayStart) return db;
  let extra = 0;
  for (const row of pendingSynthetic || []) {
    if (String(row.assignedUser?._id || row.assignedUser) !== String(uid)) continue;
    if (row.role !== workflowRole) continue;
    const rowCt = normalizeContentTypeForCapacity(row.contentType) || "reel";
    if (rowCt !== ctNorm) continue;
    if (isSameUtcDay(row.dueDate, dayStart)) extra += 1;
  }
  return db + extra;
}

/**
 * Prompt 61: primary first; if over capacity, pick another user from getAvailableUsers who fits that day.
 */
async function pickAssigneeForBufferDay({
  workflowRole,
  primaryUserId,
  workday,
  contentType,
  capacityDelta,
  flexThresholdBoost,
  pendingSynthetic,
  leaves,
  excludeContentItemId,
}) {
  const countOpts = {
    ...(excludeContentItemId ? { excludeContentItemId } : {}),
    contentType,
    contentTypeForTasks: contentType,
  };
  const tryCapacity = async (uid) => {
    if (!uid) return null;
    const threshold = await computeThresholdForUser(uid, workflowRole, contentType, {
      capacityDelta,
      flexThresholdBoost,
    });
    const n = await countStagesForUserDay(
      workflowRole,
      uid,
      workday,
      pendingSynthetic,
      countOpts
    );
    return n < threshold ? uid : null;
  };

  // Hard constraint: enforce reel-user cap (and other availability rules) even for the primary user.
  let candidates = [];
  try {
    candidates = await getAvailableUsers(workflowRole, workday, pendingSynthetic, leaves);
  } catch {
    candidates = [];
  }

  const withCapacity = [];
  for (const u of candidates) {
    const uid = u._id || u;
    const picked = await tryCapacity(uid);
    if (picked) withCapacity.push(picked);
  }

  if (withCapacity.length === 0) return null;

  const primaryStr = primaryUserId ? String(primaryUserId._id || primaryUserId) : null;
  if (primaryStr) {
    const primaryPick = withCapacity.find((id) => String(id._id || id) === primaryStr);
    if (primaryPick) return primaryPick;
  }

  return withCapacity[0];
}

/**
 * PROMPT 64 — Prefer a different available user than the previous day when capacity allows (A → B → A pattern).
 */
async function pickAssigneeForSplitDay({
  workflowRole,
  primaryUserId,
  workday,
  contentType,
  capacityDelta,
  flexThresholdBoost,
  pendingSynthetic,
  leaves,
  previousAssigneeId,
  excludeContentItemId,
}) {
  const countOpts = {
    ...(excludeContentItemId ? { excludeContentItemId } : {}),
    contentType,
    contentTypeForTasks: contentType,
  };
  const tryCapacity = async (uid) => {
    if (!uid) return null;
    const threshold = await computeThresholdForUser(uid, workflowRole, contentType, {
      capacityDelta,
      flexThresholdBoost,
    });
    const n = await countStagesForUserDay(
      workflowRole,
      uid,
      workday,
      pendingSynthetic,
      countOpts
    );
    return n < threshold ? uid : null;
  };

  let candidates = [];
  try {
    candidates = await getAvailableUsers(workflowRole, workday, pendingSynthetic, leaves);
  } catch {
    candidates = [];
  }

  const withCapacity = [];
  for (const u of candidates) {
    const uid = u._id || u;
    const ok = await tryCapacity(uid);
    if (ok) withCapacity.push(uid);
  }

  if (withCapacity.length === 0) {
    return pickAssigneeForBufferDay({
      workflowRole,
      primaryUserId,
      workday,
      contentType,
      capacityDelta,
      flexThresholdBoost,
      pendingSynthetic,
      leaves,
      excludeContentItemId,
    });
  }

  if (withCapacity.length === 1) {
    return withCapacity[0];
  }

  const prevStr =
    previousAssigneeId != null ? String(previousAssigneeId._id || previousAssigneeId) : null;
  const primaryStr = primaryUserId ? String(primaryUserId._id || primaryUserId) : null;

  if (!prevStr && primaryStr) {
    const primaryPick = withCapacity.find((id) => String(id) === primaryStr);
    if (primaryPick) return primaryPick;
  }

  if (prevStr) {
    const different = withCapacity.find((id) => String(id) !== prevStr);
    if (different) return different;
  }

  if (primaryStr) {
    const primaryPick = withCapacity.find((id) => String(id) === primaryStr);
    if (primaryPick) return primaryPick;
  }

  return withCapacity[0];
}

function warnIfSubstitutes(roleLabel, primaryId, assignees) {
  if (!primaryId || !assignees?.length) return;
  const uniq = new Set();
  for (const a of assignees) {
    if (a && String(a) !== String(primaryId)) uniq.add(String(a));
  }
  if (uniq.size > 0) {
    console.warn(
      `[scheduler] Prompt 61: ${roleLabel} substitute(s) on buffer day(s) — primary ${String(
        primaryId
      )}, also assigned: ${[...uniq].join(", ")}`
    );
  }
}

/**
 * Prompt 60 / 61 / 62: buffer utilization — walk workday-by-workday; try primary, else getAvailableUsers.
 * Prompt 62: if no replacement and ROLE_RULES.flexible, extend duration target (+1 day) up to maxDays.
 * Pending synthetic reel rows keep in-buffer capacity consistent. Only fails when zero days booked.
 *
 * @returns {{ dates: Date[], assignees: Array<null|object>, partial: boolean, failed: boolean, durationDays: number, initialDurationDays: number, extensionSteps: number }}
 */
async function fillMultiDaySlotsWithBuffer(
  role,
  userId,
  startFrom,
  requestedDays,
  holidaySet,
  options = {}
) {
  let currentTarget = requestedDays;
  let maxIterations =
    options.maxIterations ?? Math.max(requestedDays * 90, 180);
  const capacityDelta = Number.isFinite(options.capacityDelta)
    ? Math.max(0, options.capacityDelta)
    : 0;
  const leaves = options.leaves || [];
  const seedTasks = options.seedTasks || [];
  const splitAcrossUsers = options.splitAcrossUsers === true;
  const allowWeekend = options.allowWeekend === true;
  const allowFlexibleAdjustment = options.allowFlexibleAdjustment === true;
  const contentTypeForTasks = options.contentType || "reel";
  const flexThresholdBoost = allowFlexibleAdjustment ? 1 : 0;

  const dates = [];
  const assignees = [];
  const pendingSynthetic = [...seedTasks];
  let extensionSteps = 0;

  let probe = createUTCDate(startFrom);
  if (!probe) {
    return {
      dates: [],
      assignees: [],
      assignedUsersPerDay: {},
      partial: false,
      failed: true,
      durationDays: requestedDays,
      initialDurationDays: requestedDays,
      extensionSteps: 0,
    };
  }

  let iterations = 0;
  while (dates.length < currentTarget && iterations < maxIterations) {
    iterations += 1;
    const workday = createUTCDate(
      nextValidWorkdayUTC(probe, holidaySet, { allowWeekend })
    );
    if (!workday) break;

    if (!userId) {
      dates.push(workday);
      assignees.push(null);
      probe = addDaysUTC(workday, 1);
      continue;
    }

    const assignee = splitAcrossUsers
      ? await pickAssigneeForSplitDay({
          workflowRole: role,
          primaryUserId: userId,
          workday,
          contentType: contentTypeForTasks,
          capacityDelta,
          flexThresholdBoost,
          pendingSynthetic,
          leaves,
          previousAssigneeId: assignees.length ? assignees[assignees.length - 1] : null,
          excludeContentItemId: options.excludeContentItemId,
        })
      : await pickAssigneeForBufferDay({
          workflowRole: role,
          primaryUserId: userId,
          workday,
          contentType: contentTypeForTasks,
          capacityDelta,
          flexThresholdBoost,
          pendingSynthetic,
          leaves,
          excludeContentItemId: options.excludeContentItemId,
        });

    if (assignee) {
      dates.push(workday);
      assignees.push(assignee);
      pendingSynthetic.push({
        role,
        assignedUser: assignee,
        dueDate: workday,
        status: "assigned",
        contentType: contentTypeForTasks,
      });
    } else {
      const meta = getDurationExtensionMeta(role);
      if (meta.flexible && currentTarget < meta.maxDays) {
        const borrowFn = options.tryBorrowFromNextStage;
        if (typeof borrowFn === "function") {
          const br = borrowFn();
          if (br && br.ok === true) {
            currentTarget += 1;
            extensionSteps += 1;
            maxIterations += 60;
            console.warn(
              `[scheduler] Prompt 62/63: extended ${role} target to ${currentTarget} days (borrowed 1d from ${br.nextRole})`
            );
          } else if (allowFlexibleAdjustment) {
            currentTarget += 1;
            extensionSteps += 1;
            maxIterations += 60;
            console.warn(
              `[scheduler] Prompt 66: extended ${role} target to ${currentTarget} days (flexible adjustment; borrow was ${br?.reason || "unavailable"})`
            );
          } else {
            console.warn(
              `[scheduler] Prompt 63: extension reverted — borrow denied (${br?.reason || "unknown"})`
            );
          }
        } else if (allowFlexibleAdjustment) {
          currentTarget += 1;
          extensionSteps += 1;
          maxIterations += 60;
          console.warn(
            `[scheduler] Prompt 66: extended ${role} target to ${currentTarget} days (flexible adjustment; no borrow hook)`
          );
        }
      }
    }
    probe = addDaysUTC(workday, 1);
  }

  const failed = dates.length === 0;
  const partial = !failed && dates.length < currentTarget;
  const assignedUsersPerDay =
    dates.length > 0 && assignees.length === dates.length
      ? buildAssignedUsersPerDayFromSchedule(dates, assignees)
      : {};
  return {
    dates,
    assignees,
    assignedUsersPerDay,
    partial,
    failed,
    durationDays: currentTarget,
    initialDurationDays: requestedDays,
    extensionSteps,
  };
}

/**
 * Prompt 48 / 60 / 61: multi-day window (e.g. shoot = 3). Partial schedules allowed;
 * throws only when no day could be booked. Set `options.includeAssignees: true` to get `{ dates, assignees }`.
 */
async function fillMultiDaySlots(role, userId, startFrom, nDays, holidaySet, options = {}) {
  const result = await fillMultiDaySlotsWithBuffer(
    role,
    userId,
    startFrom,
    nDays,
    holidaySet,
    options
  );
  if (result.failed) {
    throw new Error(
      `[scheduler] No available ${role} days in scan window (Prompt 60: all candidate days unavailable)`
    );
  }
  if (result.partial) {
    console.warn(
      `[scheduler] Partial ${role} buffer: scheduled ${result.dates.length}/${result.durationDays ?? nDays} days (Prompt 60)`
    );
  }
  if (options.includeAssignees) {
    return {
      dates: result.dates,
      assignees: result.assignees,
      assignedUsersPerDay: result.assignedUsersPerDay,
      durationDays: result.durationDays,
      initialDurationDays: result.initialDurationDays,
      extensionSteps: result.extensionSteps,
    };
  }
  return result.dates;
}

/**
 * Core reel pipeline dates — shared by `generateClientReels` and `generateCalendarDraft` so preview matches DB.
 * Forward from stagger anchor: urgent reels = one effective business day per stage (strategist → … → post).
 * DO NOT MODIFY THIS LOGIC
 * Custom calendar rules apply only during stage movement
 */
async function computeReelStageDatesForGeneration({
  i,
  isUrgent,
  baseStartDate,
  strategistStartDate,
  holidaySet,
  schedulingOpts,
  strategistId,
  videographerId,
  videoEditorId,
  managerId,
  postingExecutiveId,
  usedReelPostingDayKeys,
  allowPostingDayStacking = false,
  postingWindow,
}) {
  const reelSchedulingOpts = {
    ...schedulingOpts,
    schedulingPlanType: isUrgent ? "urgent" : "normal",
    contentType: "reel",
    contentTypeForTasks: "reel",
  };
  const staggerOffset = isUrgent ? (i - 1) * 1 : (i - 1) * 2;
  const reelStartSeed = strategistStartDate || addDaysUTC(baseStartDate, staggerOffset);
  const reelStartDate = createUTCDate(
    nextValidWorkdayUTC(reelStartSeed, holidaySet, schedulingOpts)
  );
  const planDue = await scheduleStageDay(
    "strategist",
    strategistId,
    reelStartDate,
    holidaySet,
    reelSchedulingOpts
  );

  let shootDue;
  let editDue;
  let approvalDue;
  let postDue;

  const bufferOpts = {
    includeAssignees: true,
    capacityDelta: isUrgent ? 1 : 0,
    allowWeekend: schedulingOpts.allowWeekend,
    allowFlexibleAdjustment: !isUrgent && schedulingOpts.allowFlexibleAdjustment,
    leaves: schedulingOpts.leaves,
    splitAcrossUsers: !isUrgent,
    contentType: "reel",
    contentTypeForTasks: "reel",
  };

  const reelDurationPlan = {
    strategist: 1,
    videographer: isUrgent ? 1 : 3,
    videoEditor: isUrgent ? 1 : 2,
    manager: isUrgent ? 1 : 3,
    postingExecutive: 1,
  };
  const borrowReel = (currentRole) => () => {
    if (isUrgent) return { ok: false, reason: "urgent_no_borrowing" };
    return tryBorrowOneDayFromNextStage(currentRole, reelDurationPlan, "reel");
  };

  if (isUrgent) {
    const shootStart = addDaysUTC(planDue, 1);
    const shootOut = await fillMultiDaySlots(
      "videographer",
      videographerId,
      shootStart,
      reelDurationPlan.videographer,
      holidaySet,
      { ...bufferOpts, tryBorrowFromNextStage: borrowReel("videographer") }
    );
    warnIfSubstitutes("Shoot", videographerId, shootOut.assignees);
    shootDue = shootOut.dates[0];

    const editStart = addDaysUTC(shootDue, 1);
    const editOut = await fillMultiDaySlots(
      "videoEditor",
      videoEditorId,
      editStart,
      reelDurationPlan.videoEditor,
      holidaySet,
      { ...bufferOpts, tryBorrowFromNextStage: borrowReel("videoEditor") }
    );
    warnIfSubstitutes("Edit", videoEditorId, editOut.assignees);
    editDue = editOut.dates[0];

    const approvalStart = editDue;
    approvalDue = await scheduleStageDay(
      "manager",
      managerId,
      approvalStart,
      holidaySet,
      reelSchedulingOpts
    );

    const postStart = addDaysUTC(approvalDue, 1);
    const postOut = await fillMultiDaySlots(
      "postingExecutive",
      postingExecutiveId,
      postStart,
      reelDurationPlan.postingExecutive,
      holidaySet,
      { ...bufferOpts, tryBorrowFromNextStage: borrowReel("postingExecutive") }
    );
    warnIfSubstitutes("Post", postingExecutiveId, postOut.assignees);
    postDue = postOut.dates[0];
  } else {
    const shootStart = addDaysUTC(planDue, 1);
    const shootOut = await fillMultiDaySlots(
      "videographer",
      videographerId,
      shootStart,
      reelDurationPlan.videographer,
      holidaySet,
      { ...bufferOpts, tryBorrowFromNextStage: borrowReel("videographer") }
    );
    warnIfSubstitutes("Shoot", videographerId, shootOut.assignees);
    shootDue = shootOut.dates[shootOut.dates.length - 1];

    const editStart = addDaysUTC(shootDue, 1);
    const editOut = await fillMultiDaySlots(
      "videoEditor",
      videoEditorId,
      editStart,
      reelDurationPlan.videoEditor,
      holidaySet,
      { ...bufferOpts, tryBorrowFromNextStage: borrowReel("videoEditor") }
    );
    warnIfSubstitutes("Edit", videoEditorId, editOut.assignees);
    editDue = editOut.dates[editOut.dates.length - 1];

    const approvalStart = addDaysUTC(editDue, 1);
    const approvalOut = await fillMultiDaySlots(
      "manager",
      managerId,
      approvalStart,
      reelDurationPlan.manager,
      holidaySet,
      { ...bufferOpts, tryBorrowFromNextStage: borrowReel("manager") }
    );
    warnIfSubstitutes("Approval", managerId, approvalOut.assignees);
    approvalDue = approvalOut.dates[approvalOut.dates.length - 1];

    const postStart = addDaysUTC(approvalDue, 1);
    const postOut = await fillMultiDaySlots(
      "postingExecutive",
      postingExecutiveId,
      postStart,
      reelDurationPlan.postingExecutive,
      holidaySet,
      { ...bufferOpts, tryBorrowFromNextStage: borrowReel("postingExecutive") }
    );
    warnIfSubstitutes("Post", postingExecutiveId, postOut.assignees);
    postDue = postOut.dates[0];
  }

  if (!allowPostingDayStacking) {
    let postingKey = ymdUTC(postDue);
    while (postingKey && usedReelPostingDayKeys.has(postingKey)) {
      postDue = await scheduleStageDay(
        "postingExecutive",
        postingExecutiveId,
        addDaysUTC(postDue, 1),
        holidaySet,
        reelSchedulingOpts
      );
      postingKey = ymdUTC(postDue);
    }
    if (postingKey) usedReelPostingDayKeys.add(postingKey);
  }
  if (postingWindow?.end) {
    const end = createUTCDate(postingWindow.end);
    if (end && postDue.getTime() > end.getTime()) {
      console.warn(
        `[scheduler] Cycle overflow for reels in ${postingWindow.label || "current cycle"}; continuing beyond cycle end`
      );
    }
  }

  return { planDue, shootDue, editDue, approvalDue, postDue };
}

/** Static post / carousel: 1 + 1 + 4 + 1 day windows (spec). */
const POST_LIKE_DURATION_PLAN = {
  strategist: 1,
  graphicDesigner: 1,
  manager: 4,
  postingExecutive: 1,
};

async function computePostLikeStageDatesForGeneration({
  itemStartDate,
  holidaySet,
  schedulingOpts,
  strategistId,
  designerId,
  managerId,
  postingExecutiveId,
  usedPostingDayKeys,
  allowPostingDayStacking = false,
  postingWindow,
  contentType = "static_post",
}) {
  const postLikeOpts = {
    ...schedulingOpts,
    schedulingPlanType: "normal",
    contentType,
    contentTypeForTasks: contentType,
  };

  const planDue = await scheduleStageDay(
    "strategist",
    strategistId,
    itemStartDate,
    holidaySet,
    postLikeOpts
  );

  const borrowPost = (workflowRole) => () =>
    tryBorrowOneDayFromNextStage(workflowRole, { ...POST_LIKE_DURATION_PLAN }, "post_like");

  const designOut = await fillMultiDaySlots(
    "graphicDesigner",
    designerId,
    addDaysUTC(planDue, 1),
    POST_LIKE_DURATION_PLAN.graphicDesigner,
    holidaySet,
    {
      includeAssignees: true,
      capacityDelta: 0,
      allowWeekend: postLikeOpts.allowWeekend,
      allowFlexibleAdjustment: postLikeOpts.allowFlexibleAdjustment,
      leaves: postLikeOpts.leaves,
      splitAcrossUsers: true,
      tryBorrowFromNextStage: borrowPost("graphicDesigner"),
      contentType,
      contentTypeForTasks: contentType,
    }
  );
  const designLast = designOut.dates[designOut.dates.length - 1];

  const managerOut = await fillMultiDaySlots(
    "manager",
    managerId,
    addDaysUTC(designLast, 1),
    POST_LIKE_DURATION_PLAN.manager,
    holidaySet,
    {
      includeAssignees: true,
      capacityDelta: 0,
      allowWeekend: postLikeOpts.allowWeekend,
      allowFlexibleAdjustment: postLikeOpts.allowFlexibleAdjustment,
      leaves: postLikeOpts.leaves,
      splitAcrossUsers: true,
      tryBorrowFromNextStage: borrowPost("manager"),
      contentType,
      contentTypeForTasks: contentType,
    }
  );
  const approvalDue = managerOut.dates[managerOut.dates.length - 1];

  let postDue = await scheduleStageDay(
    "postingExecutive",
    postingExecutiveId,
    addDaysUTC(approvalDue, 1),
    holidaySet,
    postLikeOpts
  );

  if (!allowPostingDayStacking) {
    let postingKey = ymdUTC(postDue);
    while (postingKey && usedPostingDayKeys.has(postingKey)) {
      postDue = await scheduleStageDay(
        "postingExecutive",
        postingExecutiveId,
        addDaysUTC(postDue, 1),
        holidaySet,
        postLikeOpts
      );
      postingKey = ymdUTC(postDue);
    }
    if (postingKey) usedPostingDayKeys.add(postingKey);
  }
  if (postingWindow?.end) {
    const end = createUTCDate(postingWindow.end);
    if (end && postDue.getTime() > end.getTime()) {
      console.warn(
        `[scheduler] Cycle overflow for ${postingWindow.typeLabel || "content"} in ${postingWindow.label || "current cycle"}; continuing beyond cycle end`
      );
    }
  }

  return {
    planDue,
    designDue: designOut.dates[0],
    designDates: designOut.dates,
    designAssignees: designOut.assignees || [],
    approvalStart: managerOut.dates[0],
    approvalDue: managerOut.dates[managerOut.dates.length - 1],
    managerDates: managerOut.dates,
    managerAssignees: managerOut.assignees || [],
    postDue,
  };
}

async function buildReelItemForCalendarDraft({
  i,
  isUrgent,
  baseStartDate,
  strategistStartDate,
  holidaySet,
  schedulingOpts,
  reelTeam,
  usedReelPostingDayKeys,
  postingWindow,
}) {
  const strategistId = reelTeam.strategist?._id || reelTeam.strategist;
  const videographerId = reelTeam.videographer?._id || reelTeam.videographer;
  const videoEditorId = reelTeam.videoEditor?._id || reelTeam.videoEditor;
  const managerId = reelTeam.manager?._id || reelTeam.manager;
  const postingExecutiveId = reelTeam.postingExecutive?._id || reelTeam.postingExecutive;

  const { planDue, shootDue, editDue, approvalDue, postDue } = await computeReelStageDatesForGeneration({
    i,
    isUrgent,
    baseStartDate,
    strategistStartDate,
    holidaySet,
    schedulingOpts,
    strategistId,
    videographerId,
    videoEditorId,
    managerId,
    postingExecutiveId,
    usedReelPostingDayKeys,
    allowPostingDayStacking: schedulingOpts.allowPostingDayStacking === true,
    postingWindow,
  });

  const postingDate = ymdUTC(postDue);
  const reelItem = {
    contentId: `Reel #${i}`,
    title: `Reel #${i}`,
    type: "reel",
    plan: isUrgent ? "urgent" : "normal",
    planType: isUrgent ? "urgent" : "normal",
    postingDate,
    stages: [
      {
        name: "Plan",
        role: "strategist",
        assignedUser: strategistId || undefined,
        date: ymdUTC(planDue),
        status: "assigned",
      },
      {
        name: "Shoot",
        role: "videographer",
        assignedUser: videographerId || undefined,
        date: ymdUTC(shootDue),
        status: "assigned",
      },
      {
        name: "Edit",
        role: "videoEditor",
        assignedUser: videoEditorId || undefined,
        date: ymdUTC(editDue),
        status: "assigned",
      },
      {
        name: "Approval",
        role: "manager",
        assignedUser: managerId || undefined,
        date: ymdUTC(approvalDue),
        status: "assigned",
      },
      {
        name: "Post",
        role: "postingExecutive",
        assignedUser: postingExecutiveId || undefined,
        date: ymdUTC(postDue),
        status: "assigned",
      },
    ],
  };
  return { ...reelItem, tasks: normalizeDraftItemToDurationTasks(reelItem) };
}

async function buildPostItemForCalendarDraft({
  i,
  baseStartDate,
  strategistStartDate,
  holidaySet,
  schedulingOpts,
  postTeam,
  usedPostPostingDayKeys,
  postingWindow,
}) {
  const postStrategistId = postTeam.strategist?._id || postTeam.strategist;
  const postDesignerId = postTeam.graphicDesigner?._id || postTeam.graphicDesigner;
  const postManagerId = postTeam.manager?._id || postTeam.manager;
  const postPostingExecutiveId = postTeam.postingExecutive?._id || postTeam.postingExecutive;

  const staggerOffset = (i - 1) * 2;
  const itemStartSeed = strategistStartDate || addDaysUTC(baseStartDate, staggerOffset);
  const itemStartDate = createUTCDate(
    nextValidWorkdayUTC(itemStartSeed, holidaySet, schedulingOpts)
  );

  const {
    planDue,
    designDue,
    designDates,
    designAssignees,
    approvalStart,
    approvalDue,
    managerDates,
    managerAssignees,
    postDue,
  } = await computePostLikeStageDatesForGeneration({
    itemStartDate,
    holidaySet,
    schedulingOpts,
    strategistId: postStrategistId,
    designerId: postDesignerId,
    managerId: postManagerId,
    postingExecutiveId: postPostingExecutiveId,
    usedPostingDayKeys: usedPostPostingDayKeys,
    allowPostingDayStacking: schedulingOpts.allowPostingDayStacking === true,
    postingWindow: postingWindow ? { ...postingWindow, typeLabel: "posts" } : undefined,
    contentType: "static_post",
  });

  const postingDate = ymdUTC(postDue);
  const postItem = {
    contentId: `Post #${i}`,
    title: `Post #${i}`,
    type: "post",
    plan: "normal",
    planType: "normal",
    postingDate,
    stages: [
      {
        name: "Plan",
        role: "strategist",
        assignedUser: postStrategistId || undefined,
        date: ymdUTC(planDue),
        status: "assigned",
      },
      {
        name: "Design",
        role: "graphicDesigner",
        assignedUser: postDesignerId || undefined,
        date: ymdUTC(designDue),
        durationDays: POST_LIKE_DURATION_PLAN.graphicDesigner,
        assignedUsersPerDay: buildAssignedUsersPerDayFromSchedule(designDates, designAssignees),
        status: "assigned",
      },
      {
        name: "Approval",
        role: "manager",
        assignedUser: postManagerId || undefined,
        date: ymdUTC(approvalStart),
        durationDays: POST_LIKE_DURATION_PLAN.manager,
        assignedUsersPerDay: buildAssignedUsersPerDayFromSchedule(managerDates, managerAssignees),
        status: "assigned",
      },
      {
        name: "Post",
        role: "postingExecutive",
        assignedUser: postPostingExecutiveId || undefined,
        date: ymdUTC(postDue),
        status: "assigned",
      },
    ],
  };
  return { ...postItem, tasks: normalizeDraftItemToDurationTasks(postItem) };
}

async function buildCarouselItemForCalendarDraft({
  i,
  baseStartDate,
  strategistStartDate,
  holidaySet,
  schedulingOpts,
  carouselTeam,
  usedCarouselPostingDayKeys,
  postingWindow,
}) {
  const carouselStrategistId = carouselTeam.strategist?._id || carouselTeam.strategist;
  const carouselDesignerId = carouselTeam.graphicDesigner?._id || carouselTeam.graphicDesigner;
  const carouselManagerId = carouselTeam.manager?._id || carouselTeam.manager;
  const carouselPostingExecutiveId = carouselTeam.postingExecutive?._id || carouselTeam.postingExecutive;

  const staggerOffset = (i - 1) * 2;
  const itemStartSeed = strategistStartDate || addDaysUTC(baseStartDate, staggerOffset);
  const itemStartDate = createUTCDate(
    nextValidWorkdayUTC(itemStartSeed, holidaySet, schedulingOpts)
  );

  const {
    planDue,
    designDue,
    designDates,
    designAssignees,
    approvalStart,
    approvalDue,
    managerDates,
    managerAssignees,
    postDue,
  } = await computePostLikeStageDatesForGeneration({
    itemStartDate,
    holidaySet,
    schedulingOpts,
    strategistId: carouselStrategistId,
    designerId: carouselDesignerId,
    managerId: carouselManagerId,
    postingExecutiveId: carouselPostingExecutiveId,
    usedPostingDayKeys: usedCarouselPostingDayKeys,
    allowPostingDayStacking: schedulingOpts.allowPostingDayStacking === true,
    postingWindow: postingWindow ? { ...postingWindow, typeLabel: "carousels" } : undefined,
    contentType: "carousel",
  });

  const postingDate = ymdUTC(postDue);
  const carouselItem = {
    contentId: `Carousel #${i}`,
    title: `Carousel #${i}`,
    type: "carousel",
    plan: "normal",
    planType: "normal",
    postingDate,
    stages: [
      {
        name: "Plan",
        role: "strategist",
        assignedUser: carouselStrategistId || undefined,
        date: ymdUTC(planDue),
        status: "assigned",
      },
      {
        name: "Design",
        role: "graphicDesigner",
        assignedUser: carouselDesignerId || undefined,
        date: ymdUTC(designDue),
        durationDays: POST_LIKE_DURATION_PLAN.graphicDesigner,
        assignedUsersPerDay: buildAssignedUsersPerDayFromSchedule(designDates, designAssignees),
        status: "assigned",
      },
      {
        name: "Approval",
        role: "manager",
        assignedUser: carouselManagerId || undefined,
        date: ymdUTC(approvalStart),
        durationDays: POST_LIKE_DURATION_PLAN.manager,
        assignedUsersPerDay: buildAssignedUsersPerDayFromSchedule(managerDates, managerAssignees),
        status: "assigned",
      },
      {
        name: "Post",
        role: "postingExecutive",
        assignedUser: carouselPostingExecutiveId || undefined,
        date: ymdUTC(postDue),
        status: "assigned",
      },
    ],
  };
  return { ...carouselItem, tasks: normalizeDraftItemToDurationTasks(carouselItem) };
}

/**
 * Sequential reel generation with capacity-aware dates (Prompt 48).
 * Skips public holidays/weekends on assignable days; respects TeamCapacity across all clients.
 *
 * @param {object|string} client - client document or client id
 * @param {{ allowWeekend?: boolean; allowFlexibleAdjustment?: boolean }} [options] — PROMPT 65/66: `allowWeekend` uses Sat/Sun when true; `allowFlexibleAdjustment` relaxes capacity/extension (manager override).
 */
async function generateClientReels(client, options = {}) {
  let schedulingOpts = {
    allowWeekend: options.allowWeekend === true,
    allowFlexibleAdjustment: options.allowFlexibleAdjustment === true,
    leaves: Array.isArray(options.leaves) ? options.leaves : [],
  };
  const clientId = client?._id || client;
  if (!clientId) return { insertedCount: 0, endDate: null };

  const populatedClient = await Client.findById(clientId)
    .populate("package")
    .populate("team.reels.strategist")
    .populate("team.reels.videographer")
    .populate("team.reels.videoEditor")
    .populate("team.reels.manager")
    .populate("team.reels.postingExecutive")
    .select("startDate endDate manager createdBy package team activeContentCounts")
    .lean();

  if (!populatedClient?.startDate) return { insertedCount: 0, endDate: null };
  const firstMonth = getMonthKey(populatedClient.startDate);

  const plan = populatedClient.activeContentCounts;
  const hasPlan =
    plan &&
    (Number.isFinite(plan.noOfReels) ||
      Number.isFinite(plan.noOfStaticPosts) ||
      Number.isFinite(plan.noOfCarousels));

  const reelsCount = hasPlan
    ? Number(plan.noOfReels) || 0
    : populatedClient?.package?.noOfReels || 0;
  const postsCount = hasPlan
    ? Number(plan.noOfStaticPosts) || 0
    : (Number(populatedClient?.package?.noOfPosts) || 0) + (Number(populatedClient?.package?.noOfStaticPosts) || 0);
  const carouselsCount = hasPlan
    ? Number(plan.noOfCarousels) || 0
    : populatedClient?.package?.noOfCarousels || 0;
  const totalCount = reelsCount + postsCount + carouselsCount;
  if (!Number.isFinite(totalCount) || totalCount <= 0) {
    const start = createUTCDate(populatedClient.startDate);
    if (start) {
      await Client.updateOne({ _id: populatedClient._id }, { $set: { endDate: start } });
    }
    return { insertedCount: 0, endDate: start || null };
  }

  const startSeedDate = createUTCDate(populatedClient.startDate);
  if (!startSeedDate) return { insertedCount: 0, endDate: null };
  const baseStartDate = addDaysUTC(startSeedDate, 1);

  const estimateEnd = addDaysUTC(baseStartDate, totalCount * 40 + 180);
  const holidaySet = await buildHolidaySetUTC(baseStartDate, estimateEnd);

  if (!Array.isArray(options.leaves)) {
    const leaveDocs = await Leave.find({
      startDate: { $lte: estimateEnd },
      endDate: { $gte: baseStartDate },
    }).lean();
    schedulingOpts.leaves = (leaveDocs || []).map((doc) => ({
      userId: doc.userId,
      from: doc.startDate,
      to: doc.endDate,
    }));
  }

  const team = populatedClient.team || {};
  const reelTeam = getTeamForContentType(team, "reel");
  const postTeam = getTeamForContentType(team, "post");
  const carouselTeam = getTeamForContentType(team, "carousel");
  const managerId =
    reelTeam.manager?._id ||
    reelTeam.manager ||
    populatedClient.manager?._id ||
    populatedClient.manager;
  const createdBy = populatedClient.createdBy || managerId;
  const isCustomCalendar = Boolean(populatedClient.isCustomCalendar);
  const weekendEnabled = Boolean(populatedClient.weekendEnabled);

  const strategistId = reelTeam.strategist?._id || reelTeam.strategist;
  const videographerId = reelTeam.videographer?._id || reelTeam.videographer;
  const videoEditorId = reelTeam.videoEditor?._id || reelTeam.videoEditor;
  const postingExecutiveId =
    reelTeam.postingExecutive?._id || reelTeam.postingExecutive;
  const postStrategistId = postTeam.strategist?._id || postTeam.strategist;
  const postDesignerId =
    postTeam.graphicDesigner?._id || postTeam.graphicDesigner;
  const postManagerId =
    postTeam.manager?._id || postTeam.manager;
  const postPostingExecutiveId =
    postTeam.postingExecutive?._id || postTeam.postingExecutive;
  const carouselStrategistId =
    carouselTeam.strategist?._id || carouselTeam.strategist;
  const carouselDesignerId =
    carouselTeam.graphicDesigner?._id || carouselTeam.graphicDesigner;
  const carouselManagerId =
    carouselTeam.manager?._id || carouselTeam.manager;
  const carouselPostingExecutiveId =
    carouselTeam.postingExecutive?._id || carouselTeam.postingExecutive;

  let insertedCount = 0;
  let lastPostingDate = null;
  const usedReelPostingDayKeys = new Set();
  const usedPostPostingDayKeys = new Set();
  const usedCarouselPostingDayKeys = new Set();
  const keepLatestPosting = (d) => {
    const cur = createUTCDate(d);
    if (!cur) return;
    if (!lastPostingDate || cur.getTime() > lastPostingDate.getTime()) {
      lastPostingDate = cur;
    }
  };

  /** PROMPT 68: urgent first, then earliest stagger anchor (proxy for earliest post), then normal — interleaves content types. */
  const workUnits = buildSortedWorkUnitsClientGeneration(
    baseStartDate,
    reelsCount,
    postsCount,
    carouselsCount,
    addDaysUTC,
    populatedClient.startDate // Prompt 209
  );
  const strategistStarts = buildStrategistStartDates({
    baseStartDate,
    reelsCount,
    postsCount,
    carouselsCount,
    holidaySet,
  });

  for (const unit of workUnits) {
    if (unit.kind === "reel") {
    const i = unit.index;
    const reelMonth = getMonthKey(unit.anchorDate);
    const isFirstMonth = reelMonth === firstMonth;
    const isUrgent = isFirstMonth && i <= 2;
    const {
      planDue,
      shootDue,
      editDue,
      approvalDue,
      postDue,
    } = await computeReelStageDatesForGeneration({
      i,
      isUrgent,
      baseStartDate,
      strategistStartDate: strategistStarts.reel[i - 1],
      holidaySet,
      schedulingOpts,
      strategistId,
      videographerId,
      videoEditorId,
      managerId,
      postingExecutiveId,
      usedReelPostingDayKeys,
    });

    const postingDate = createUTCDate(postDue);
    keepLatestPosting(postingDate);

    const workflowStages = [
      {
        stageName: "Plan",
        role: "strategist",
        assignedUser: strategistId || undefined,
        dueDate: createUTCDate(planDue),
        status: "assigned",
      },
      {
        stageName: "Shoot",
        role: "videographer",
        assignedUser: videographerId || undefined,
        dueDate: createUTCDate(shootDue),
        status: "assigned",
      },
      {
        stageName: "Edit",
        role: "videoEditor",
        assignedUser: videoEditorId || undefined,
        dueDate: createUTCDate(editDue),
        status: "assigned",
      },
      {
        stageName: "Approval",
        role: "manager",
        assignedUser: managerId || undefined,
        dueDate: createUTCDate(approvalDue),
        status: "assigned",
      },
      {
        stageName: "Post",
        role: "postingExecutive",
        assignedUser: postingExecutiveId || undefined,
        dueDate: createUTCDate(postDue),
        status: "assigned",
      },
    ];

    await ContentItem.create({
      client: populatedClient._id,
      contentType: "reel",
      type: "reel",
      plan: isUrgent ? "urgent" : "normal",
      planType: isUrgent ? "urgent" : "normal",
      title: `Reel #${i}`,
      month: toMonthStringUTC(postingDate),
      clientPostingDate: createUTCDate(postingDate),
      workflowStages,
      isCustomCalendar,
      weekendEnabled,
      createdBy,
    });
    insertedCount += 1;
    } else if (unit.kind === "post") {
    const i = unit.index;
    const staggerOffset = (i - 1) * 2;
    const itemStartSeed = strategistStarts.post[i - 1] || addDaysUTC(baseStartDate, staggerOffset);
    const itemStartDate = createUTCDate(
      nextValidWorkdayUTC(itemStartSeed, holidaySet, schedulingOpts)
    );

    const { planDue, designDue, approvalDue, postDue } = await computePostLikeStageDatesForGeneration({
      itemStartDate,
      holidaySet,
      schedulingOpts,
      strategistId: postStrategistId,
      designerId: postDesignerId,
      managerId: postManagerId,
      postingExecutiveId: postPostingExecutiveId,
      usedPostingDayKeys: usedPostPostingDayKeys,
      contentType: "static_post",
    });

    const postingDate = createUTCDate(postDue);
    keepLatestPosting(postingDate);

    await ContentItem.create({
      client: populatedClient._id,
      contentType: "static_post",
      type: "post",
      plan: "normal",
      planType: "normal",
      title: `Post #${i}`,
      month: toMonthStringUTC(postingDate),
      clientPostingDate: postingDate,
      workflowStages: [
        {
          stageName: "Plan",
          role: "strategist",
          assignedUser: postStrategistId || undefined,
          dueDate: createUTCDate(planDue),
          status: "assigned",
        },
        {
          stageName: "Design",
          role: "graphicDesigner",
          assignedUser: postDesignerId || undefined,
          dueDate: createUTCDate(designDue),
          status: "assigned",
        },
        {
          stageName: "Approval",
          role: "manager",
          assignedUser: postManagerId || undefined,
          dueDate: createUTCDate(approvalDue),
          status: "assigned",
        },
        {
          stageName: "Post",
          role: "postingExecutive",
          assignedUser: postPostingExecutiveId || undefined,
          dueDate: createUTCDate(postDue),
          status: "assigned",
        },
      ],
      isCustomCalendar,
      weekendEnabled,
      createdBy,
    });
    insertedCount += 1;
    } else {
    const i = unit.index;
    const staggerOffset = (i - 1) * 2;
    const itemStartSeed =
      strategistStarts.carousel[i - 1] || addDaysUTC(baseStartDate, staggerOffset);
    const itemStartDate = createUTCDate(
      nextValidWorkdayUTC(itemStartSeed, holidaySet, schedulingOpts)
    );

    const { planDue, designDue, approvalDue, postDue } = await computePostLikeStageDatesForGeneration({
      itemStartDate,
      holidaySet,
      schedulingOpts,
      strategistId: carouselStrategistId,
      designerId: carouselDesignerId,
      managerId: carouselManagerId,
      postingExecutiveId: carouselPostingExecutiveId,
      usedPostingDayKeys: usedCarouselPostingDayKeys,
      contentType: "carousel",
    });

    const postingDate = createUTCDate(postDue);
    keepLatestPosting(postingDate);

    await ContentItem.create({
      client: populatedClient._id,
      contentType: "carousel",
      type: "carousel",
      plan: "normal",
      planType: "normal",
      title: `Carousel #${i}`,
      month: toMonthStringUTC(postingDate),
      clientPostingDate: postingDate,
      workflowStages: [
        {
          stageName: "Plan",
          role: "strategist",
          assignedUser: carouselStrategistId || undefined,
          dueDate: createUTCDate(planDue),
          status: "assigned",
        },
        {
          stageName: "Design",
          role: "graphicDesigner",
          assignedUser: carouselDesignerId || undefined,
          dueDate: createUTCDate(designDue),
          status: "assigned",
        },
        {
          stageName: "Approval",
          role: "manager",
          assignedUser: carouselManagerId || undefined,
          dueDate: createUTCDate(approvalDue),
          status: "assigned",
        },
        {
          stageName: "Post",
          role: "postingExecutive",
          assignedUser: carouselPostingExecutiveId || undefined,
          dueDate: createUTCDate(postDue),
          status: "assigned",
        },
      ],
      isCustomCalendar,
      weekendEnabled,
      createdBy,
    });
    insertedCount += 1;
    }
  }

  if (lastPostingDate) {
    await Client.updateOne(
      { _id: populatedClient._id },
      { $set: { endDate: createUTCDate(lastPostingDate) } }
    );
  }

  return {
    insertedCount,
    endDate: lastPostingDate ? createUTCDate(lastPostingDate) : null,
  };
}

module.exports = {
  generateClientReels,
  computeReelStageDatesForGeneration,
  buildReelItemForCalendarDraft,
  buildPostItemForCalendarDraft,
  buildCarouselItemForCalendarDraft,
  fillMultiDaySlots,
  fillMultiDaySlotsWithBuffer,
  scheduleStageDay,
  nextValidWorkdayUTC,
  buildStrategistStartDates,
  buildHolidaySetUTC,
  pickAssigneeForBufferDay,
  pickAssigneeForSplitDay,
  countStagesForUserDay,
  getDurationExtensionMeta,
};
