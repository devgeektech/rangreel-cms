const Client = require("../models/Client");
const User = require("../models/User");
const mongoose = require("mongoose");
const ClientScheduleDraft = require("../models/ClientScheduleDraft");
const ContentItem = require("../models/ContentItem");
const Leave = require("../models/Leave");
const GlobalEditLock = require("../models/GlobalEditLock");
const { validateStagesNotAfterPosting, isAfterDate } = require("./stageBoundary.service");
const {
  normalizeDraftItemToDurationTasks,
  normalizeStageToDurationTask,
} = require("./taskNormalizer.service");
const { tryBorrowOneDayFromNextStage, getMinDaysForWorkflowRole } = require("./durationBorrowing.service");
const {
  scheduleStageDay,
  nextValidWorkdayUTC,
  buildHolidaySetUTC,
  fillMultiDaySlotsWithBuffer,
  pickAssigneeForBufferDay,
} = require("./simpleCalendar.service");

const USER_EDITABLE_STAGES = new Set(["Plan", "Shoot", "Edit", "Approval"]);
const GLOBAL_DRAG_LOCK_KEY = "manager-global-drag-lock";
const LOCK_TTL_MS = 60 * 1000;

async function acquireGlobalDragLock(managerUserId) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LOCK_TTL_MS);
  try {
    await GlobalEditLock.create({
      key: GLOBAL_DRAG_LOCK_KEY,
      lockedBy: managerUserId,
      lockedAt: now,
      expiresAt,
    });
    return true;
  } catch (err) {
    if (err && err.code === 11000) return false;
    throw err;
  }
}

async function releaseGlobalDragLock() {
  await GlobalEditLock.deleteOne({ key: GLOBAL_DRAG_LOCK_KEY });
}

function humanRole(role) {
  const r = String(role || "").toLowerCase();
  if (r === "videographer") return "videographer";
  if (r === "videoeditor") return "editor";
  if (r === "graphicdesigner") return "designer";
  if (r === "postingexecutive") return "posting executive";
  if (r === "strategist") return "strategist";
  if (r === "manager") return "manager";
  return r || "user";
}

// YYYY-MM-DD must be parsed as UTC calendar date (local getters break ISO strings in US TZs).
function normalizeUTCDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  if (typeof value === "string") {
    const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const day = Number(m[3]);
      if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(day)) return null;
      return new Date(Date.UTC(y, mo - 1, day));
    }
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function createUTCDate(date) {
  return normalizeUTCDate(date);
}

function addDaysUTC(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toYMD(value) {
  const d = normalizeUTCDate(value);
  if (!d) return "";
  return d.toISOString().slice(0, 10);
}

function isWeekendDateUTC(value) {
  const d = normalizeUTCDate(value);
  if (!d) return false;
  const wd = d.getUTCDay();
  return wd === 0 || wd === 6;
}

/**
 * How many consecutive workdays can be booked from startFrom with each day strictly before postingDate.
 * Used to clamp edit/approval multi-day fills so stages stay before post.
 */
function maxConsecutiveWorkdaysBeforePost(startFrom, postingDate, holidaySet, dayOpts, maxWanted) {
  if (!startFrom || !postingDate) return Math.max(1, Math.min(maxWanted, 20));
  if (startFrom.getTime() >= postingDate.getTime()) return 0;
  const cap = Math.min(Math.max(1, maxWanted), 20);
  const dates = [];
  let wd =
    createUTCDate(nextValidWorkdayUTC(startFrom, holidaySet, dayOpts)) || createUTCDate(startFrom);
  for (let i = 0; i < cap; i++) {
    if (wd.getTime() >= postingDate.getTime()) break;
    dates.push(wd);
    const nextProbe = addDaysUTC(wd, 1);
    wd =
      createUTCDate(nextValidWorkdayUTC(nextProbe, holidaySet, dayOpts)) || createUTCDate(nextProbe);
  }
  return dates.length;
}

function ymdKeysFromPerDay(perDay) {
  if (!perDay || typeof perDay !== "object") return [];
  return Object.keys(perDay).filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k)).sort();
}

/**
 * Video editor (Edit) window: prefer persisted tasks + per-day keys (matches global calendar),
 * then correct multi-day convention where draft `Edit.date` is the inclusive last day after buffer fill.
 */
function getVideoEditorTaskWindow(item) {
  const contentId = item?.contentId ?? item?.title ?? "item";
  const stages = item?.stages || [];
  const editIdx = stages.findIndex((s) => String(s?.name) === "Edit");
  const editStage = editIdx >= 0 ? stages[editIdx] : null;

  const tasksArr =
    Array.isArray(item?.tasks) && item.tasks.length ? item.tasks : normalizeDraftItemToDurationTasks(item);
  const t = (tasksArr || []).find((x) => String(x?.role || "").toLowerCase() === "videoeditor");

  const pk = ymdKeysFromPerDay(t?.assignedUsersPerDay);
  if (pk.length >= 1) {
    return {
      first: normalizeUTCDate(pk[0]),
      last: normalizeUTCDate(pk[pk.length - 1]),
    };
  }

  const dt = editStage ? normalizeStageToDurationTask(contentId, editStage, Math.max(0, editIdx)) : null;
  const dur = Math.max(1, Number(dt?.durationDays || t?.durationDays) || 1);
  if (!dt?.startDate || !dt?.endDate) {
    if (t?.startDate && t?.endDate) {
      return { first: normalizeUTCDate(t.startDate), last: normalizeUTCDate(t.endDate) };
    }
    return { first: null, last: null };
  }

  let first = normalizeUTCDate(dt.startDate);
  let last = normalizeUTCDate(dt.endDate);
  const stored = normalizeUTCDate(editStage?.date);

  if (dur > 1 && stored && first && last) {
    const sy = toYMD(stored);
    const fy = toYMD(first);
    const ly = toYMD(last);
    if (sy === ly && sy !== fy) {
      last = stored;
      first = addDaysUTC(last, -(dur - 1));
    }
  }

  if (first && last) return { first, last };
  return { first: null, last: null };
}

/**
 * Manager (Approval) window — same derivation pattern as Edit for multi-day reels.
 */
function getManagerApprovalTaskWindow(item) {
  const contentId = item?.contentId ?? item?.title ?? "item";
  const stages = item?.stages || [];
  const apprIdx = stages.findIndex((s) => String(s?.name) === "Approval");
  const apprStage = apprIdx >= 0 ? stages[apprIdx] : null;

  const tasksArr =
    Array.isArray(item?.tasks) && item.tasks.length ? item.tasks : normalizeDraftItemToDurationTasks(item);
  const t = (tasksArr || []).find((x) => String(x?.role || "").toLowerCase() === "manager");

  const pk = ymdKeysFromPerDay(t?.assignedUsersPerDay);
  if (pk.length >= 1) {
    return {
      first: normalizeUTCDate(pk[0]),
      last: normalizeUTCDate(pk[pk.length - 1]),
    };
  }

  const dt = apprStage ? normalizeStageToDurationTask(contentId, apprStage, Math.max(0, apprIdx)) : null;
  const dur = Math.max(1, Number(dt?.durationDays || t?.durationDays) || 1);
  if (!dt?.startDate || !dt?.endDate) {
    if (t?.startDate && t?.endDate) {
      return { first: normalizeUTCDate(t.startDate), last: normalizeUTCDate(t.endDate) };
    }
    return { first: null, last: null };
  }

  let first = normalizeUTCDate(dt.startDate);
  let last = normalizeUTCDate(dt.endDate);
  const stored = normalizeUTCDate(apprStage?.date);

  if (dur > 1 && stored && first && last) {
    const sy = toYMD(stored);
    const fy = toYMD(first);
    const ly = toYMD(last);
    if (sy === ly && sy !== fy) {
      last = stored;
      first = addDaysUTC(last, -(dur - 1));
    }
  }

  if (first && last) return { first, last };
  return { first: null, last: null };
}

/**
 * PROMPT 67 — Manager drag: apply change, manager override (weekend + flexible capacity),
 * then run scheduler (replacement → buffer multi-day → scheduleStageDay fallback).
 *
 * @param {{ managerUserId: string, contentId: string, stageName: string, newDate: string|Date, fromGlobalCalendar?: boolean, targetUserId?: string }} params
 * @returns {Promise<{ ok: true, data: object } | { ok: false, status?: number, error: string, details?: object }>}
 */
async function runManagerDragTask({
  managerUserId,
  contentId,
  stageName,
  newDate: newDateInput,
  allowWeekend,
  fromGlobalCalendar = false,
  targetUserId: targetUserIdInput,
}) {
  const weekendEnabled = allowWeekend === true;
  const lockAcquired = await acquireGlobalDragLock(managerUserId);
  if (!lockAcquired) {
    return {
      ok: false,
      status: 423,
      error: "System is busy applying another manager drag. Please retry.",
      details: { code: "GLOBAL_DRAG_LOCKED" },
    };
  }

  let session = null;
  try {
  const schedulingMeta = {
    allowWeekend: weekendEnabled,
    allowFlexibleAdjustment: true,
    replacementApplied: false,
    bufferUsed: false,
    durationAdjusted: false,
    borrowed: false,
    weekendAllowed: true,
    extensionSteps: 0,
    originalDurationDays: 1,
    finalDurationDays: 1,
    reason: "",
  };

  if (!contentId || !stageName || newDateInput == null) {
    return { ok: false, status: 400, error: "contentId, stageName and newDate are required" };
  }
  if (!USER_EDITABLE_STAGES.has(String(stageName))) {
    return {
      ok: false,
      status: 400,
      error: "Only Plan, Shoot, Edit, and Approval stages can be moved",
    };
  }

  // PROMPT 82: global-only edits must fetch ALL ContentItems (all clients).
  await ContentItem.find({}).select("_id").lean();

  const draft = await ClientScheduleDraft.findOne({ "items.contentId": contentId });
  if (!draft) return { ok: false, status: 404, error: "Schedule draft not found" };

  const client = await Client.findOne({ _id: draft.clientId, manager: managerUserId }).select("_id").lean();
  if (!client) return { ok: false, status: 403, error: "Client not found or access denied" };

  const item = (draft.items || []).find(
    (it) => it?.contentId && String(it.contentId) === String(contentId)
  );
  if (!item) return { ok: false, status: 404, error: "Draft item not found" };

  const stages = item.stages || [];
  const stageIndex = stages.findIndex((s) => String(s?.name) === String(stageName));
  if (stageIndex === -1) return { ok: false, status: 404, error: "Stage not found for this content item" };

  const contentItemLean = await ContentItem.findById(contentId)
    .select("planType workflowStages clientPostingDate type contentType isCustomCalendar")
    .lean();
  if (!contentItemLean) return { ok: false, status: 404, error: "Content item not found" };
  if (!contentItemLean.isCustomCalendar) {
    return {
      ok: false,
      status: 400,
      error: "Editing not allowed in global calendar",
      details: { code: "GLOBAL_CALENDAR_PROTECTED" },
    };
  }

  const planType = String(contentItemLean.planType || "normal").toLowerCase();
  const isUrgent = planType === "urgent";
  const urgentCapacityDelta = isUrgent ? 1 : 0;
  const allowFlexibleAdjustment = !isUrgent;
  schedulingMeta.allowFlexibleAdjustment = allowFlexibleAdjustment;

  const requested = normalizeUTCDate(newDateInput);
  if (!requested) return { ok: false, status: 400, error: "newDate must be a valid date" };
  if (!weekendEnabled) {
    const wd = requested.getUTCDay();
    if (wd === 0 || wd === 6) {
      return {
        ok: false,
        status: 400,
        error: "Weekend dates are blocked",
        details: { code: "WEEKEND_BLOCKED" },
      };
    }
  }

  const postingDate = normalizeUTCDate(item.postingDate);
  if (postingDate && isAfterDate(requested, postingDate)) {
    return {
      ok: false,
      status: 400,
      error: "Cannot maintain post date",
      details: { code: "POST_DATE_LOCKED", postingDate: toYMD(postingDate) },
    };
  }

  const targetStage = stages[stageIndex];
  const oldTargetDate = normalizeUTCDate(targetStage?.date);
  let primaryUserId = targetStage?.assignedUser;
  if (targetUserIdInput && mongoose.Types.ObjectId.isValid(String(targetUserIdInput))) {
    const targetUserExists = await User.findById(targetUserIdInput).select("_id").lean();
    if (targetUserExists) primaryUserId = targetUserIdInput;
  }
  if (!primaryUserId) return { ok: false, status: 400, error: "Stage has no assigned user" };

  const role = targetStage.role;
  if (!role) return { ok: false, status: 400, error: "Stage has no role" };

  const dt = normalizeStageToDurationTask(contentId, targetStage, 0);
  let durationDays = Math.max(1, Number(dt.durationDays) || 1);
  schedulingMeta.originalDurationDays = durationDays;
  schedulingMeta.finalDurationDays = durationDays;

  const itemType = String(item.type || contentItemLean.type || "").toLowerCase();
  const isReel = itemType === "reel";
  const rawCt = String(contentItemLean.contentType || "").toLowerCase();
  let contentTypeForTasks = "static_post";
  if (rawCt === "reel" || itemType === "reel") contentTypeForTasks = "reel";
  else if (rawCt === "carousel" || itemType === "carousel") contentTypeForTasks = "carousel";
  else contentTypeForTasks = "static_post";

  const estimateStart = addDaysUTC(requested, -120);
  const estimateEnd = addDaysUTC(requested, 120);
  const holidaySet = await buildHolidaySetUTC(estimateStart, estimateEnd);

  const leaveDocs = await Leave.find({
    startDate: { $lte: estimateEnd },
    endDate: { $gte: estimateStart },
  }).lean();
  const leaves = (leaveDocs || []).map((doc) => ({
    userId: doc.userId,
    from: doc.startDate,
    to: doc.endDate,
  }));

  const schedulingOpts = {
    allowWeekend: weekendEnabled,
    allowFlexibleAdjustment,
    excludeContentItemId: contentId,
    leaves,
    schedulingPlanType: isUrgent ? "urgent" : "normal",
    contentType: contentTypeForTasks,
    contentTypeForTasks,
  };

  const bufferBase = {
    includeAssignees: true,
    capacityDelta: urgentCapacityDelta,
    allowWeekend: weekendEnabled,
    allowFlexibleAdjustment,
    excludeContentItemId: contentId,
    contentType: contentTypeForTasks,
    leaves,
    splitAcrossUsers: !isUrgent,
  };

  const reelDurationPlan = {
    strategist: 1,
    videographer: isUrgent ? 1 : 3,
    videoEditor: isUrgent ? 1 : 2,
    manager: isUrgent ? 1 : 3,
    postingExecutive: 1,
  };
  /** Snapshot before buffer fill — tryBorrowOneDayFromNextStage mutates reelDurationPlan (e.g. edit 2d → 1d when shoot borrows). */
  const initialVideoEditorPlanDays = reelDurationPlan.videoEditor;
  const postDurationPlan = {
    strategist: 1,
    graphicDesigner: 1,
    manager: 4,
    postingExecutive: 1,
  };

  const pipelineKind = isReel ? "reel" : "post_like";
  const durationPlan = isReel ? reelDurationPlan : postDurationPlan;
  const borrowFor = (workflowRole) => () => {
    // Urgent flow: replacement only, no borrowing.
    if (isUrgent) return { ok: false, reason: "urgent_no_borrowing" };
    return tryBorrowOneDayFromNextStage(workflowRole, durationPlan, pipelineKind);
  };

  let resolvedTargetDate;
  let resolvedAssignee = primaryUserId;

  const dayOpts = { allowWeekend: weekendEnabled };
  const anchorRaw = createUTCDate(nextValidWorkdayUTC(requested, holidaySet, dayOpts));
  if (!anchorRaw) {
    return { ok: false, status: 400, error: "Could not resolve a valid calendar day for this drag" };
  }
  const requestedYmd = toYMD(requested);
  const anchorYmd = toYMD(anchorRaw);
  const shiftedFromRequested = requestedYmd && anchorYmd && requestedYmd !== anchorYmd;

  const useBuffer =
    durationDays > 1 &&
    (isReel
      ? ["videographer", "videoEditor", "manager"].includes(role)
      : role === "graphicDesigner" || role === "manager");

  if (useBuffer) {
    schedulingMeta.bufferUsed = true;
    let startFrom;
    if (isUrgent) {
      startFrom = anchorRaw;
    } else {
      startFrom = createUTCDate(addDaysUTC(anchorRaw, -(durationDays - 1)));
    }
    if (!startFrom) {
      return { ok: false, status: 400, error: "Invalid buffer start date" };
    }

    const tryBufferWithMode = (allowWeekendMode) =>
      fillMultiDaySlotsWithBuffer(
        role,
        primaryUserId,
        startFrom,
        durationDays,
        holidaySet,
        {
          ...bufferBase,
          allowWeekend: allowWeekendMode,
          tryBorrowFromNextStage: borrowFor(role),
        }
      );

    let bufferOut = await tryBufferWithMode(false);
    // Weekend can be attempted only after weekday scheduling fails.
    if ((bufferOut.failed || bufferOut.partial) && weekendEnabled) {
      bufferOut = await tryBufferWithMode(true);
      schedulingMeta.weekendAllowed = true;
    }

    if (isUrgent && (bufferOut.extensionSteps || 0) > 0) {
      return {
        ok: false,
        status: 409,
        error: "Urgent plan does not allow duration adjustments",
        details: { code: "URGENT_NO_FLEXIBILITY", stage: stageName, role },
      };
    }

    if (String(role || "").toLowerCase() === "strategist" && bufferOut.extensionSteps > 0) {
      return {
        ok: false,
        status: 409,
        error: "Strategist stage cannot borrow or reduce duration",
        details: { code: "STRATEGIST_STRICT_RULE", stage: stageName, role },
      };
    }

    if (String(role || "").toLowerCase() === "postingexecutive" && (bufferOut.failed || bufferOut.partial)) {
      return {
        ok: false,
        status: 409,
        error: "Post stage conflict cannot be adjusted",
        details: { code: "POST_STAGE_STRICT_FAIL", stage: stageName, role },
      };
    }

    if (bufferOut.failed) {
      const scheduledDays = (bufferOut.dates || []).length;
      const msg =
        durationDays > 1
          ? `No available ${humanRole(role)} for required days`
          : `No available ${humanRole(role)} for this date`;
      const reasons = ["No replacement available", "Capacity full"];
      if (shiftedFromRequested) reasons.push("Holiday conflict");
      return {
        ok: false,
        status: 409,
        error: msg,
        details: {
          code: "NO_AVAILABLE_FOR_REQUIRED_DAYS",
          reasons,
          stage: stageName,
          role,
          requiredDays: durationDays,
          scheduledDays,
          buffer: {
            failed: bufferOut.failed,
            partial: bufferOut.partial,
            datesScheduled: scheduledDays,
            durationDays: bufferOut.durationDays,
            initialDurationDays: bufferOut.initialDurationDays,
            extensionSteps: bufferOut.extensionSteps,
          },
        },
      };
    }

    if (bufferOut.partial) {
      const scheduledDays = (bufferOut.dates || []).length;
      const isEditor = String(role || "").toLowerCase() === "videoeditor";
      return {
        ok: false,
        status: 409,
        error: isEditor
          ? "Editor minimum duration violated"
          : "Minimum duration violated",
        details: {
          code: "MIN_DURATION_VIOLATED",
          reasons: shiftedFromRequested
            ? ["No replacement available", "Capacity full", "Holiday conflict"]
            : ["No replacement available", "Capacity full"],
          stage: stageName,
          role,
          requiredDays: durationDays,
          scheduledDays,
          buffer: {
            failed: bufferOut.failed,
            partial: bufferOut.partial,
            datesScheduled: scheduledDays,
            durationDays: bufferOut.durationDays,
            initialDurationDays: bufferOut.initialDurationDays,
            extensionSteps: bufferOut.extensionSteps,
          },
        },
      };
    }

    if (bufferOut.extensionSteps > 0) {
      schedulingMeta.durationAdjusted = true;
      schedulingMeta.extensionSteps = bufferOut.extensionSteps;
      schedulingMeta.borrowed = true;
      schedulingMeta.finalDurationDays = Number(bufferOut.durationDays || durationDays);
    }

    const dates = bufferOut.dates || [];
    if (dates.length === 0) {
      return {
        ok: false,
        status: 409,
        error: `All users unavailable`,
        details: {
          code: "ALL_USERS_UNAVAILABLE",
          reasons: shiftedFromRequested
            ? ["No replacement available", "Capacity full", "Holiday conflict"]
            : ["No replacement available", "Capacity full"],
          stage: stageName,
          role,
          requiredDays: durationDays,
        },
      };
    }

    resolvedTargetDate = createUTCDate(isUrgent ? dates[0] : dates[dates.length - 1]);
    const assignees = bufferOut.assignees || [];
    const lastAssignee = assignees.length ? assignees[assignees.length - 1] : null;
    if (lastAssignee && String(lastAssignee) !== String(primaryUserId)) {
      schedulingMeta.replacementApplied = true;
      resolvedAssignee = lastAssignee;
    }
  } else {
    const pickForDay = (workday) =>
      pickAssigneeForBufferDay({
        workflowRole: role,
        primaryUserId,
        workday,
        contentType: contentTypeForTasks,
        capacityDelta: urgentCapacityDelta,
        flexThresholdBoost: allowFlexibleAdjustment ? 1 : 0,
        pendingSynthetic: [],
        leaves,
        excludeContentItemId: contentId,
      });

    let picked = await pickForDay(anchorRaw);

    if (picked) {
      resolvedTargetDate = anchorRaw;
      resolvedAssignee = picked;
      if (String(picked) !== String(primaryUserId)) {
        schedulingMeta.replacementApplied = true;
      }
    } else {
      // CASE 7 + CASE 5: urgent/strategist use replacement-only behavior.
      const strictReplacementOnly =
        isUrgent || String(role || "").toLowerCase() === "strategist";
      if (strictReplacementOnly) {
        return {
          ok: false,
          status: 409,
          error: "No replacement available for strict stage",
          details: {
            code: isUrgent ? "URGENT_REPLACEMENT_REQUIRED" : "STRATEGIST_REPLACEMENT_REQUIRED",
            reasons: ["No replacement available"],
            stage: stageName,
            role,
          },
        };
      }

      // Weekday-first scheduling. Weekend is attempted only as final fallback when manager enables it.
      const weekdayScheduled = await scheduleStageDay(
        role,
        primaryUserId,
        anchorRaw,
        holidaySet,
        { ...schedulingOpts, allowWeekend: false }
      );
      if (weekdayScheduled && !isWeekendDateUTC(weekdayScheduled)) {
        resolvedTargetDate = weekdayScheduled;
        resolvedAssignee = primaryUserId;
      } else if (weekendEnabled) {
        const weekendScheduled = await scheduleStageDay(
          role,
          primaryUserId,
          anchorRaw,
          holidaySet,
          { ...schedulingOpts, allowWeekend: true }
        );
        if (!weekendScheduled) {
          return {
            ok: false,
            status: 409,
            error: "No available resources to complete before post date",
            details: { code: "NO_RESOURCE_AVAILABLE", stage: stageName, role },
          };
        }
        resolvedTargetDate = weekendScheduled;
        resolvedAssignee = primaryUserId;
      } else {
        return {
          ok: false,
          status: 409,
          error: "No available resources to complete before post date",
          details: { code: "NO_RESOURCE_AVAILABLE", stage: stageName, role },
        };
      }
    }
  }

  targetStage.date = resolvedTargetDate;
  targetStage.assignedUser = resolvedAssignee;

  /**
   * Normal reel: Shoot/Edit use multi-day windows. Blind calendar-delta on downstream stages
   * breaks "Edit starts day after Shoot ends" and can push Edit/Approval onto/after posting date.
   * Re-fill Edit → Approval forward from the new anchor instead.
   */
  const dayOptsChain = { allowWeekend: weekendEnabled };
  const forwardChainNormalReelShoot =
    isReel &&
    !isUrgent &&
    String(stageName) === "Shoot" &&
    useBuffer &&
    String(role || "").toLowerCase() === "videographer";

  const forwardChainNormalReelEdit =
    isReel &&
    !isUrgent &&
    String(stageName) === "Edit" &&
    useBuffer &&
    String(role || "").toLowerCase() === "videoeditor";

  const tryBufferWeekendFallback = async (workflowRole, userId, startFrom, nDays, borrowRole) => {
    let out = await fillMultiDaySlotsWithBuffer(
      workflowRole,
      userId,
      startFrom,
      nDays,
      holidaySet,
      {
        ...bufferBase,
        tryBorrowFromNextStage: borrowFor(borrowRole),
      }
    );
    if ((out.failed || out.partial) && weekendEnabled) {
      out = await fillMultiDaySlotsWithBuffer(
        workflowRole,
        userId,
        startFrom,
        nDays,
        holidaySet,
        {
          ...bufferBase,
          allowWeekend: true,
          tryBorrowFromNextStage: borrowFor(borrowRole),
        }
      );
    }
    return out;
  };

  if (forwardChainNormalReelShoot) {
    const shootEnd = resolvedTargetDate;
    let chainCursor =
      createUTCDate(nextValidWorkdayUTC(addDaysUTC(shootEnd, 1), holidaySet, dayOptsChain)) ||
      addDaysUTC(shootEnd, 1);

    const editSt = stages.find((s) => String(s?.name) === "Edit");
    const editWin = getVideoEditorTaskWindow(item);
    /** Global calendar only: shoot buffer borrowed a day from the editor plan (e.g. videographer on leave). Must re-fill edit, do not preserve stale window. */
    const editDaysBorrowedForShoot =
      fromGlobalCalendar &&
      Number(reelDurationPlan.videoEditor) < Number(initialVideoEditorPlanDays);
    /** Shoot moved earlier off leave/weekends; existing edit window still starts after the new shoot end — keep edit dates. */
    const preserveEditAfterShootMove =
      !editDaysBorrowedForShoot &&
      editSt?.assignedUser &&
      editWin.first &&
      editWin.last &&
      shootEnd.getTime() < editWin.first.getTime() &&
      (!postingDate || editWin.last.getTime() <= postingDate.getTime());

    const apprSt = stages.find((s) => String(s?.name) === "Approval");
    const apprWin = getManagerApprovalTaskWindow(item);
    const preserveApprovalAfterShootEditPreserve =
      preserveEditAfterShootMove &&
      apprSt?.assignedUser &&
      apprWin.first &&
      apprWin.last &&
      editWin.first &&
      editWin.last &&
      editWin.last.getTime() < apprWin.first.getTime() &&
      (!postingDate || apprWin.last.getTime() <= postingDate.getTime());

    if (editSt?.assignedUser) {
      if (preserveEditAfterShootMove) {
        chainCursor =
          createUTCDate(nextValidWorkdayUTC(addDaysUTC(editWin.last, 1), holidaySet, dayOptsChain)) ||
          addDaysUTC(editWin.last, 1);
      } else {
        if (postingDate && chainCursor.getTime() >= postingDate.getTime()) {
          return {
            ok: false,
            status: 400,
            error: "Cannot maintain post date",
            details: { code: "POST_DATE_LOCKED", postingDate: toYMD(postingDate), reason: "edit_chain" },
          };
        }
        const maxEditSlots = postingDate
          ? maxConsecutiveWorkdaysBeforePost(
              chainCursor,
              postingDate,
              holidaySet,
              dayOptsChain,
              reelDurationPlan.videoEditor
            )
          : reelDurationPlan.videoEditor;
        if (postingDate && maxEditSlots === 0) {
          return {
            ok: false,
            status: 400,
            error: "Cannot maintain post date",
            details: { code: "POST_DATE_LOCKED", postingDate: toYMD(postingDate), reason: "edit_chain" },
          };
        }
        const minEditDays = getMinDaysForWorkflowRole("videoEditor");
        let editNDays = postingDate
          ? Math.max(minEditDays, Math.min(reelDurationPlan.videoEditor, maxEditSlots))
          : reelDurationPlan.videoEditor;
        let editOut = await tryBufferWeekendFallback(
          "videoEditor",
          editSt.assignedUser,
          chainCursor,
          editNDays,
          "videoEditor"
        );
        while ((editOut.failed || editOut.partial) && editNDays > minEditDays) {
          editNDays -= 1;
          editOut = await tryBufferWeekendFallback(
            "videoEditor",
            editSt.assignedUser,
            chainCursor,
            editNDays,
            "videoEditor"
          );
        }
        if (editOut.failed || editOut.partial) {
          return {
            ok: false,
            status: 409,
            error: "Cannot reschedule edit after shoot — not enough working days before the posting date",
            details: {
              code: "REEL_CHAIN_EDIT_FAIL",
              stage: "Edit",
              buffer: {
                failed: editOut.failed,
                partial: editOut.partial,
                durationDays: editOut.durationDays,
              },
            },
          };
        }
        const editDates = editOut.dates || [];
        const editLast = editDates[editDates.length - 1];
        editSt.date = editLast;
        const eas = editOut.assignees || [];
        if (eas.length) {
          const lastA = eas[eas.length - 1];
          if (lastA) editSt.assignedUser = lastA;
        }
        chainCursor =
          createUTCDate(nextValidWorkdayUTC(addDaysUTC(editLast, 1), holidaySet, dayOptsChain)) ||
          addDaysUTC(editLast, 1);
      }
    }

    if (apprSt?.assignedUser) {
      if (preserveApprovalAfterShootEditPreserve) {
        // Keep existing Approval dates; edit window was preserved and approval still fits before post.
      } else if (postingDate && chainCursor.getTime() >= postingDate.getTime()) {
        return {
          ok: false,
          status: 400,
          error: "Cannot maintain post date",
          details: { code: "POST_DATE_LOCKED", postingDate: toYMD(postingDate), reason: "approval_chain" },
        };
      } else {
        const maxApprSlots = postingDate
          ? maxConsecutiveWorkdaysBeforePost(
              chainCursor,
              postingDate,
              holidaySet,
              dayOptsChain,
              reelDurationPlan.manager
            )
          : reelDurationPlan.manager;
        if (postingDate && maxApprSlots === 0) {
          return {
            ok: false,
            status: 400,
            error: "Cannot maintain post date",
            details: { code: "POST_DATE_LOCKED", postingDate: toYMD(postingDate), reason: "approval_chain" },
          };
        }
        const minMgrDays = getMinDaysForWorkflowRole("manager");
        let apprNDays = postingDate
          ? Math.max(minMgrDays, Math.min(reelDurationPlan.manager, maxApprSlots))
          : reelDurationPlan.manager;

        let apprOut = await tryBufferWeekendFallback(
          "manager",
          apprSt.assignedUser,
          chainCursor,
          apprNDays,
          "manager"
        );
        while ((apprOut.failed || apprOut.partial) && apprNDays > minMgrDays) {
          apprNDays -= 1;
          apprOut = await tryBufferWeekendFallback(
            "manager",
            apprSt.assignedUser,
            chainCursor,
            apprNDays,
            "manager"
          );
        }
        if (apprOut.failed || apprOut.partial) {
          return {
            ok: false,
            status: 409,
            error: "Cannot reschedule approval after edit — not enough working days before the posting date",
            details: {
              code: "REEL_CHAIN_APPROVAL_FAIL",
              stage: "Approval",
              buffer: {
                failed: apprOut.failed,
                partial: apprOut.partial,
                durationDays: apprOut.durationDays,
              },
            },
          };
        }
        const apprDates = apprOut.dates || [];
        const apprLast = apprDates[apprDates.length - 1];
        apprSt.date = apprLast;
        const mas = apprOut.assignees || [];
        if (mas.length) {
          const lastM = mas[mas.length - 1];
          if (lastM) apprSt.assignedUser = lastM;
        }
      }
    }
  } else if (forwardChainNormalReelEdit) {
    const editEnd = resolvedTargetDate;
    let chainCursor =
      createUTCDate(nextValidWorkdayUTC(addDaysUTC(editEnd, 1), holidaySet, dayOptsChain)) ||
      addDaysUTC(editEnd, 1);

    const apprSt = stages.find((s) => String(s?.name) === "Approval");
    if (apprSt?.assignedUser) {
      if (postingDate && chainCursor.getTime() >= postingDate.getTime()) {
        return {
          ok: false,
          status: 400,
          error: "Cannot maintain post date",
          details: { code: "POST_DATE_LOCKED", postingDate: toYMD(postingDate), reason: "approval_after_edit" },
        };
      }
      const maxApprSlotsEdit = postingDate
        ? maxConsecutiveWorkdaysBeforePost(
            chainCursor,
            postingDate,
            holidaySet,
            dayOptsChain,
            reelDurationPlan.manager
          )
        : reelDurationPlan.manager;
      if (postingDate && maxApprSlotsEdit === 0) {
        return {
          ok: false,
          status: 400,
          error: "Cannot maintain post date",
          details: { code: "POST_DATE_LOCKED", postingDate: toYMD(postingDate), reason: "approval_after_edit" },
        };
      }
      const minMgrDaysEdit = getMinDaysForWorkflowRole("manager");
      let apprNDaysEdit = postingDate
        ? Math.max(minMgrDaysEdit, Math.min(reelDurationPlan.manager, maxApprSlotsEdit))
        : reelDurationPlan.manager;

      let apprOut = await tryBufferWeekendFallback(
        "manager",
        apprSt.assignedUser,
        chainCursor,
        apprNDaysEdit,
        "manager"
      );
      while ((apprOut.failed || apprOut.partial) && apprNDaysEdit > minMgrDaysEdit) {
        apprNDaysEdit -= 1;
        apprOut = await tryBufferWeekendFallback(
          "manager",
          apprSt.assignedUser,
          chainCursor,
          apprNDaysEdit,
          "manager"
        );
      }
      if (apprOut.failed || apprOut.partial) {
        return {
          ok: false,
          status: 409,
          error: "Cannot reschedule approval after edit — not enough working days before the posting date",
          details: {
            code: "REEL_CHAIN_APPROVAL_FAIL",
            stage: "Approval",
            buffer: {
              failed: apprOut.failed,
              partial: apprOut.partial,
              durationDays: apprOut.durationDays,
            },
          },
        };
      }
      const apprDates = apprOut.dates || [];
      apprSt.date = apprDates[apprDates.length - 1];
      const mas = apprOut.assignees || [];
      if (mas.length) {
        const lastM = mas[mas.length - 1];
        if (lastM) apprSt.assignedUser = lastM;
      }
    }
  } else {
    const deltaMs = oldTargetDate ? resolvedTargetDate.getTime() - oldTargetDate.getTime() : 0;

    for (let i = stageIndex + 1; i < stages.length; i++) {
      const s = stages[i];
      if (!USER_EDITABLE_STAGES.has(String(s?.name))) break;
      if (!s?.assignedUser) continue;
      const oldNextDate = normalizeUTCDate(s.date) || addDaysUTC(resolvedTargetDate, i - stageIndex);
      let shiftedByDelta = normalizeUTCDate(addDaysUTC(oldNextDate, Math.round(deltaMs / 86400000)));
      if (postingDate && shiftedByDelta && shiftedByDelta.getTime() > postingDate.getTime()) {
        shiftedByDelta = postingDate;
      }
      const next = normalizeUTCDate(
        await scheduleStageDay(s.role, s.assignedUser, shiftedByDelta, holidaySet, schedulingOpts)
      );
      if (postingDate && next && next.getTime() > postingDate.getTime()) {
        s.date = postingDate;
      } else {
        s.date = next;
      }
    }
  }

  const approvalStage = stages.find((s) => String(s?.name) === "Approval");
  if (approvalStage?.date && postingDate) {
    const approvalDate = normalizeUTCDate(approvalStage.date);
    if (approvalDate && approvalDate.getTime() >= postingDate.getTime()) {
      return {
        ok: false,
        status: 400,
        error: "Cannot maintain post date",
        details: { code: "POST_DATE_LOCKED", postingDate: toYMD(postingDate) },
      };
    }
  }

  const boundary = validateStagesNotAfterPosting(stages, postingDate);
  if (!boundary.ok) {
    return {
      ok: false,
      status: 409,
      error: "Cannot maintain post date",
      details: { violations: boundary.violations },
    };
  }

  // Hard constraint: enforce strict stage sequence (Plan < Shoot < Edit < Approval < Post).
  // We validate only the stages present in the draft payload.
  const STAGE_ORDER = ["Plan", "Shoot", "Edit", "Approval", "Post"];
  const byName = new Map(
    (stages || []).map((s) => [String(s?.name || s?.stageName || ""), normalizeUTCDate(s?.date)])
  );
  const utcYmd = (t) => {
    const x = normalizeUTCDate(t);
    return x ? x.toISOString().slice(0, 10) : "";
  };
  for (let i = 0; i < STAGE_ORDER.length - 1; i++) {
    const aName = STAGE_ORDER[i];
    const bName = STAGE_ORDER[i + 1];
    const aDate = byName.get(aName);
    const bDate = byName.get(bName);
    if (!aDate || !bDate) continue;
    const yA = utcYmd(aDate);
    const yB = utcYmd(bDate);
    if (yA === yB && aName === "Edit" && bName === "Approval") continue;
    if (aDate.getTime() >= bDate.getTime()) {
      return {
        ok: false,
        status: 409,
        error: "Task sequence would be violated by this drag",
        details: {
          code: "SEQUENCE_VIOLATION",
          from: aName,
          to: bName,
          fromDate: toYMD(aDate),
          toDate: toYMD(bDate),
        },
      };
    }
  }

  const contentItemDoc = await ContentItem.findById(contentId);
  if (!contentItemDoc) return { ok: false, status: 404, error: "Content item not found" };

  const stageDateByName = new Map(
    (item.stages || []).map((s) => [String(s.name), normalizeUTCDate(s.date)])
  );
  const stageAssigneeByName = new Map(
    (item.stages || []).map((s) => [String(s.name), s.assignedUser])
  );
  contentItemDoc.workflowStages = (contentItemDoc.workflowStages || []).map((ws) => {
    const key = String(ws.stageName || "");
    if (!USER_EDITABLE_STAGES.has(key)) return ws;
    if (stageDateByName.has(key)) ws.dueDate = stageDateByName.get(key);
    const au = stageAssigneeByName.get(key);
    if (au != null) ws.assignedUser = au;
    return ws;
  });
  item.tasks = normalizeDraftItemToDurationTasks(item);
  draft.markModified("items");

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    await contentItemDoc.save({ session });
    await draft.save({ session });

    await session.commitTransaction();
    session.endSession();
    session = null;
  } catch (txErr) {
    const msg = String(txErr?.message || "");
    const txnUnsupported =
      msg.includes("Transaction numbers are only allowed on a replica set member or mongos") ||
      msg.includes("replica set member");
    if (!txnUnsupported) {
      throw txErr;
    }
    if (session) {
      try {
        await session.abortTransaction();
      } catch (_) {
        // ignore abort failures in fallback path
      }
      session.endSession();
      session = null;
    }
    // Fallback for standalone MongoDB: global lock still prevents concurrent drag writes.
    await contentItemDoc.save();
    await draft.save();
  }

  const updatedItem = {
    contentId: item.contentId,
    type: item.type,
    stages: (item.stages || []).map((s) => ({
      name: s.name,
      role: s.role,
      assignedUser: s.assignedUser,
      date: toYMD(s.date),
      status: s.status,
    })),
    postingDate: toYMD(item.postingDate),
    isLocked: Boolean(item.isLocked),
  };

  schedulingMeta.reason = schedulingMeta.replacementApplied
    ? "User replaced to satisfy capacity/availability"
    : schedulingMeta.durationAdjusted
    ? "Duration adjusted using borrow/extension"
    : schedulingMeta.bufferUsed
    ? "Buffered placement applied"
    : "Scheduled without adjustments";

  const updatedCalendar = {
    clientId: draft.clientId ? String(draft.clientId) : "",
    items: (draft.items || []).map((it) => ({
      contentId: it.contentId,
      type: it.type,
      stages: (it.stages || []).map((s) => ({
        name: s.name,
        role: s.role,
        assignedUser: s.assignedUser,
        date: toYMD(s.date),
        status: s.status,
      })),
      postingDate: toYMD(it.postingDate),
      isLocked: Boolean(it.isLocked),
      tasks: Array.isArray(it.tasks) ? it.tasks : [],
    })),
  };

  return {
    ok: true,
    data: {
      item: updatedItem,
      calendar: updatedCalendar,
      scheduling: schedulingMeta,
    },
  };
  } catch (err) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    return {
      ok: false,
      status: 500,
      error: err.message || "Global drag failed",
      details: { code: "GLOBAL_DRAG_FAILED" },
    };
  } finally {
    await releaseGlobalDragLock();
  }
}

module.exports = {
  runManagerDragTask,
};
