/**
 * PROMPT 107 — Global scheduler: borrow 1 day from the next stage before split / weekend escalation / hard fail.
 *
 * `fillMultiDaySlotsWithBufferP107` mirrors `simpleCalendar.service.js` with a borrow pass when a day
 * cannot be assigned (leave / capacity / no availability). Integrate by replacing the local
 * `fillMultiDaySlotsWithBuffer` in `simpleCalendar.service.js` with this implementation, or re-export
 * it from that module.
 */

const TeamCapacity = require("../models/TeamCapacity");
const { resolveRoleCapacity } = require("./capacityAvailability.service");
const { getNextStageTask } = require("./constraintEngine.moveValidation");
const { tryBorrowOneDayFromNextStage } = require("./durationBorrowing.service");
const { canBorrowFromPipelineTask, clampStageDurationDaysForRole } = require("./durationValidation.service");
const { buildAssignedUsersPerDayFromSchedule } = require("./taskNormalizer.service");
const {
  pickAssigneeForBufferDay,
  pickAssigneeForSplitDay,
  nextValidWorkdayUTC,
  getDurationExtensionMeta,
} = require("./simpleCalendar.service");

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

function extendTaskByOneDay(task) {
  if (!task || typeof task !== "object") return false;
  const n = Math.max(1, Number(task.durationDays) || 1);
  task.durationDays = n + 1;
  return true;
}

function reduceTaskByOneDay(task) {
  if (!task || typeof task !== "object") return false;
  const n = Math.max(1, Number(task.durationDays) || 1);
  if (n <= 1) return false;
  task.durationDays = n - 1;
  return true;
}

/**
 * PROMPT 107 — Borrow one day from the next stage when it still has duration &gt; 1.
 * Mutates `durationPlan` (via tryBorrowOneDayFromNextStage) and keeps `tasks` mirrors in sync.
 *
 * @param {object} params
 * @param {string} params.role — workflow role for the stage being filled (e.g. videographer)
 * @param {object} params.currentTask — task row for this stage (must have `role`, `durationDays`)
 * @param {object[]} params.tasks — synthetic sibling tasks (same pipeline / content item)
 * @param {Record<string, number>} params.durationPlan — mutable plan (strategist, videographer, …)
 * @param {"reel"|"post_like"} params.pipelineKind
 */
function tryBorrowBeforeFail107({
  role,
  currentTask,
  tasks,
  durationPlan,
  pipelineKind,
}) {
  if (!durationPlan || !pipelineKind || !Array.isArray(tasks)) {
    return { ok: false, reason: "missing_borrow_context" };
  }
  const ct =
    currentTask ||
    tasks.find((t) => String(t.role).toLowerCase() === String(role).toLowerCase()) ||
    null;
  if (!ct) return { ok: false, reason: "missing_current_task" };

  const nextTask = getNextStageTask(ct, tasks);
  if (!nextTask) return { ok: false, reason: "no_next_task" };

  if (!canBorrowFromPipelineTask(nextTask)) {
    return { ok: false, reason: "cannot_borrow_next_p108" };
  }

  const br = tryBorrowOneDayFromNextStage(role, durationPlan, pipelineKind);
  if (!br || br.ok !== true) return br || { ok: false, reason: "borrow_denied" };

  extendTaskByOneDay(ct);
  reduceTaskByOneDay(nextTask);

  return { ok: true, borrowed: true, ...br };
}

/**
 * High-level simulation: run allocation; on failure, attempt PROMPT 107 borrow once, then re-run.
 *
 * @param {object} params
 * @param {() => Promise<{ success?: boolean }>} params.runAllocation
 * @param {object} [params.borrow]
 * @returns {Promise<{ result: object, borrowed: boolean, borrowMeta?: object }>}
 */
async function simulateSchedule(params) {
  const run = params && params.runAllocation;
  if (typeof run !== "function") {
    throw new Error("simulateSchedule: runAllocation is required");
  }

  let first = await run();
  if (first && first.success !== false) {
    return { result: first, borrowed: false };
  }

  const borrow = params.borrow || {};
  const br = tryBorrowBeforeFail107(borrow);
  if (!br || br.ok !== true) {
    return { result: first, borrowed: false, borrowAttempted: br };
  }

  const second = await run();
  return {
    result: second,
    borrowed: true,
    borrowMeta: br,
  };
}

/**
 * Same as `simpleCalendar.fillMultiDaySlotsWithBuffer`, but when a workday has no assignee
 * (leave / capacity / no availability), runs PROMPT 107 borrow **before** flexible extension /
 * legacy borrow hook (and before advancing the probe — `continue` retries the same workday).
 */
async function fillMultiDaySlotsWithBufferP107(
  role,
  userId,
  startFrom,
  requestedDays,
  holidaySet,
  options = {}
) {
  let currentTarget = requestedDays;
  let maxIterations = options.maxIterations ?? Math.max(requestedDays * 90, 180);
  const capacityDelta = Number.isFinite(options.capacityDelta) ? Math.max(0, options.capacityDelta) : 0;
  const leaves = options.leaves || [];
  const seedTasks = options.seedTasks || [];
  const splitAcrossUsers = options.splitAcrossUsers === true;
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
    const workday = createUTCDate(nextValidWorkdayUTC(probe, holidaySet, { allowWeekend }));
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
      const bctx = options.borrowContext107;
      if (bctx && bctx.durationPlan && bctx.tasks && bctx.pipelineKind) {
        const currentTask =
          bctx.tasks.find((t) => String(t.role).toLowerCase() === String(role).toLowerCase()) || {
            role,
            durationDays: currentTarget,
          };
        if (!currentTask.durationDays) currentTask.durationDays = currentTarget;

        const br107 = tryBorrowBeforeFail107({
          role,
          currentTask,
          tasks: bctx.tasks,
          durationPlan: bctx.durationPlan,
          pipelineKind: bctx.pipelineKind,
        });

        if (br107 && br107.ok === true) {
          currentTarget += 1;
          extensionSteps += 1;
          maxIterations += 60;
          console.warn(
            `[globalScheduler] PROMPT 107: borrowed 1d from next stage for ${role}; target ${currentTarget}d`
          );
          continue;
        }
      }

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
              `[scheduler] Prompt 66: extended ${role} target to ${currentTarget} days (flexible adjustment; borrow was ${br && br.reason ? br.reason : "unavailable"})`
            );
          } else {
            console.warn(
              `[scheduler] Prompt 63: extension reverted — borrow denied (${br && br.reason ? br.reason : "unknown"})`
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
 * Build `{ tasks, durationPlan, pipelineKind }` for reel generation (matches computeReelStageDatesForGeneration).
 */
function buildReelBorrowContext107(durationPlan, pipelineKind = "reel") {
  const chain =
    pipelineKind === "post_like"
      ? ["strategist", "graphicDesigner", "manager", "postingExecutive"]
      : ["strategist", "videographer", "videoEditor", "manager", "postingExecutive"];
  const tasks = chain
    .filter((r) => durationPlan[r] != null)
    .map((r) => ({
      role: r,
      durationDays: clampStageDurationDaysForRole(r, Number(durationPlan[r]) || 1),
    }));
  return {
    tasks,
    durationPlan,
    pipelineKind,
  };
}

/** Merge PROMPT 107 borrow context into buffer options (reel or post_like plan). */
function attachBorrowContext107(bufferOpts, durationPlan, pipelineKind = "reel") {
  return {
    ...bufferOpts,
    borrowContext107: buildReelBorrowContext107(durationPlan, pipelineKind),
  };
}

/**
 * Same contract as `simpleCalendar.fillMultiDaySlots`, but uses `fillMultiDaySlotsWithBufferP107`.
 */
async function fillMultiDaySlotsP107(role, userId, startFrom, nDays, holidaySet, options = {}) {
  const result = await fillMultiDaySlotsWithBufferP107(
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

module.exports = {
  simulateSchedule,
  tryBorrowBeforeFail107,
  extendTaskByOneDay,
  reduceTaskByOneDay,
  fillMultiDaySlotsWithBufferP107,
  fillMultiDaySlotsP107,
  buildReelBorrowContext107,
  attachBorrowContext107,
  /** PROMPT 108 — re-export for callers */
  canBorrow: require("./durationValidation.service").canBorrow,
  canBorrowFromPipelineTask,
};
