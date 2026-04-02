const Client = require("../models/Client");
const ContentItem = require("../models/ContentItem");
const PublicHoliday = require("../models/PublicHoliday");
const Leave = require("../models/Leave");
const {
  getNextAvailableDate,
  countActiveStagesOnDay,
  resolveRoleCapacity,
  MAX_SEARCH_DAYS: CAPACITY_MAX_SEARCH_DAYS,
} = require("./capacityAvailability.service");
const TeamCapacity = require("../models/TeamCapacity");
const { getAvailableUsers } = require("./availability.service");
const { ROLE_RULES } = require("../config/roleRules");
const { tryBorrowOneDayFromNextStage } = require("./durationBorrowing.service");
const { buildAssignedUsersPerDayFromSchedule } = require("./taskNormalizer.service");
const { buildSortedWorkUnitsClientGeneration } = require("./schedulerPriority.service");

/** workflowStages[].role → ROLE_RULES key (Prompt 62). */
const WORKFLOW_ROLE_TO_RULE_KEY = {
  strategist: "strategist",
  videographer: "shoot",
  videoEditor: "editor",
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
function createUTCDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
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
  let anchor = createUTCDate(nextValidWorkdayUTC(fromDate, holidaySet, dayOpts));
  if (!anchor) throw new Error("Invalid anchor date");
  if (!userId) return anchor;

  const maxAlign = Math.min(370, CAPACITY_MAX_SEARCH_DAYS + 5);

  for (let iter = 0; iter < maxAlign; iter++) {
    const raw = await getNextAvailableDate(role, userId, anchor, {
      capacityDelta: flexCapDelta,
      excludeContentItemId: schedulingOptions.excludeContentItemId,
      leaves: schedulingOptions.leaves,
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
  const db = await countActiveStagesOnDay(workflowRole, uid, workday, countOptions);
  const dayStart = createUTCDate(workday);
  if (!dayStart) return db;
  let extra = 0;
  for (const row of pendingSynthetic || []) {
    if (String(row.assignedUser?._id || row.assignedUser) !== String(uid)) continue;
    if (row.role !== workflowRole) continue;
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
  threshold,
  pendingSynthetic,
  leaves,
  excludeContentItemId,
}) {
  const countOpts = excludeContentItemId ? { excludeContentItemId } : {};
  const tryCapacity = async (uid) => {
    if (!uid) return null;
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
  threshold,
  pendingSynthetic,
  leaves,
  previousAssigneeId,
  excludeContentItemId,
}) {
  const countOpts = excludeContentItemId ? { excludeContentItemId } : {};
  const tryCapacity = async (uid) => {
    if (!uid) return null;
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
      threshold,
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
  // CASE 10: multi-resource split is not allowed.
  const splitAcrossUsers = false;
  const allowWeekend = options.allowWeekend === true;
  const allowFlexibleAdjustment = options.allowFlexibleAdjustment === true;
  const contentTypeForTasks = options.contentType || "reel";
  const flexThresholdBoost = allowFlexibleAdjustment ? 1 : 0;

  const capDoc = await TeamCapacity.findOne({ role }).select("dailyCapacity").lean();
  const threshold = resolveRoleCapacity(capDoc) + capacityDelta + flexThresholdBoost;

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
          threshold,
          pendingSynthetic,
          leaves,
          previousAssigneeId: assignees.length ? assignees[assignees.length - 1] : null,
          excludeContentItemId: options.excludeContentItemId,
        })
      : await pickAssigneeForBufferDay({
          workflowRole: role,
          primaryUserId: userId,
          workday,
          threshold,
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
 * Sequential reel generation with capacity-aware dates (Prompt 48).
 * Skips public holidays/weekends on assignable days; respects TeamCapacity across all clients.
 *
 * @param {object|string} client - Client document or client id
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
    addDaysUTC
  );

  for (const unit of workUnits) {
    if (unit.kind === "reel") {
    const i = unit.index;
    const isUrgent = i <= 2;
    // Prompt 55: urgent reels start tighter; normal reels keep wider stagger.
    const staggerOffset = isUrgent ? (i - 1) * 1 : (i - 1) * 2;
    const reelStartSeed = addDaysUTC(baseStartDate, staggerOffset);
    // Prompt 57/58 (critical): fixed per-reel anchor from stagger. Never mutated globally.
    const reelStartDate = createUTCDate(
      nextValidWorkdayUTC(reelStartSeed, holidaySet, schedulingOpts)
    );
    // Stage execution dates are capacity-based and flow from previous stage outputs.
    // Only stage dates shift; the reel anchor remains locked.
    const planDue = await scheduleStageDay(
      "strategist",
      strategistId,
      reelStartDate,
      holidaySet,
      schedulingOpts
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
      splitAcrossUsers: false,
    };

    /** PROMPT 63: mutable planned durations; borrow reduces next stage when extending. */
    const reelDurationPlan = {
      strategist: 1,
      videographer: isUrgent ? 1 : 3,
      videoEditor: isUrgent ? 1 : 2,
      manager: isUrgent ? 1 : 3,
      postingExecutive: 1,
    };
    const borrowReel = (currentRole) => () => {
      // CASE 7: urgent plan has no borrowing.
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
      // Prompt 44: urgent — first manager slot on or after edit day (same day if capacity allows).
      approvalDue = await scheduleStageDay(
        "manager",
        managerId,
        approvalStart,
        holidaySet,
        schedulingOpts
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

    // Prompt 56: avoid client-calendar clustering by spreading post days.
    // If a day is already used by another reel of the same client batch, push forward.
    let postingKey = ymdUTC(postDue);
    while (postingKey && usedReelPostingDayKeys.has(postingKey)) {
      postDue = await scheduleStageDay(
        "postingExecutive",
        postingExecutiveId,
        addDaysUTC(postDue, 1),
        holidaySet,
        schedulingOpts
      );
      postingKey = ymdUTC(postDue);
    }
    if (postingKey) usedReelPostingDayKeys.add(postingKey);

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
      createdBy,
    });
    insertedCount += 1;
    } else if (unit.kind === "post") {
    const i = unit.index;
    const staggerOffset = (i - 1) * 2;
    const itemStartSeed = addDaysUTC(baseStartDate, staggerOffset);
    const itemStartDate = createUTCDate(
      nextValidWorkdayUTC(itemStartSeed, holidaySet, schedulingOpts)
    );

    const planDue = await scheduleStageDay(
      "strategist",
      postStrategistId,
      itemStartDate,
      holidaySet,
      schedulingOpts
    );
    const designDue = await scheduleStageDay(
      "graphicDesigner",
      postDesignerId,
      addDaysUTC(planDue, 1),
      holidaySet,
      schedulingOpts
    );
    // same day as design OR next day, depending on capacity/workday.
    const approvalDue = await scheduleStageDay(
      "manager",
      postManagerId,
      designDue,
      holidaySet,
      schedulingOpts
    );
    let postDue = await scheduleStageDay(
      "postingExecutive",
      postPostingExecutiveId,
      addDaysUTC(approvalDue, 1),
      holidaySet,
      schedulingOpts
    );

    let postingKey = ymdUTC(postDue);
    while (postingKey && usedPostPostingDayKeys.has(postingKey)) {
      postDue = await scheduleStageDay(
        "postingExecutive",
        postPostingExecutiveId,
        addDaysUTC(postDue, 1),
        holidaySet,
        schedulingOpts
      );
      postingKey = ymdUTC(postDue);
    }
    if (postingKey) usedPostPostingDayKeys.add(postingKey);

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
      createdBy,
    });
    insertedCount += 1;
    } else {
    const i = unit.index;
    const staggerOffset = (i - 1) * 2;
    const itemStartSeed = addDaysUTC(baseStartDate, staggerOffset);
    const itemStartDate = createUTCDate(
      nextValidWorkdayUTC(itemStartSeed, holidaySet, schedulingOpts)
    );

    const planDue = await scheduleStageDay(
      "strategist",
      carouselStrategistId,
      itemStartDate,
      holidaySet,
      schedulingOpts
    );
    const designDue = await scheduleStageDay(
      "graphicDesigner",
      carouselDesignerId,
      addDaysUTC(planDue, 1),
      holidaySet,
      schedulingOpts
    );
    const approvalDue = await scheduleStageDay(
      "manager",
      carouselManagerId,
      designDue,
      holidaySet,
      schedulingOpts
    );
    let postDue = await scheduleStageDay(
      "postingExecutive",
      carouselPostingExecutiveId,
      addDaysUTC(approvalDue, 1),
      holidaySet,
      schedulingOpts
    );

    let postingKey = ymdUTC(postDue);
    while (postingKey && usedCarouselPostingDayKeys.has(postingKey)) {
      postDue = await scheduleStageDay(
        "postingExecutive",
        carouselPostingExecutiveId,
        addDaysUTC(postDue, 1),
        holidaySet,
        schedulingOpts
      );
      postingKey = ymdUTC(postDue);
    }
    if (postingKey) usedCarouselPostingDayKeys.add(postingKey);

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
  fillMultiDaySlots,
  fillMultiDaySlotsWithBuffer,
  scheduleStageDay,
  nextValidWorkdayUTC,
  buildHolidaySetUTC,
  pickAssigneeForBufferDay,
  pickAssigneeForSplitDay,
  countStagesForUserDay,
  getDurationExtensionMeta,
};
