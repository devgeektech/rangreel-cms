const Client = require("../models/Client");
const ContentItem = require("../models/ContentItem");
const PublicHoliday = require("../models/PublicHoliday");
const {
  getNextAvailableDate,
  MAX_SEARCH_DAYS: CAPACITY_MAX_SEARCH_DAYS,
} = require("./capacityAvailability.service");

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

const nextValidWorkdayUTC = (date, holidaySet) => {
  let d = createUTCDate(date);
  if (!d) return null;
  const holidays = holidaySet instanceof Set ? holidaySet : new Set();

  for (let i = 0; i < 370; i++) {
    const key = ymdUTC(d);
    const isHoliday = key && holidays.has(key);
    if (!isWeekendUTC(d) && !isHoliday) return d;
    d = addDaysUTC(d, 1);
  }

  return d;
};

/**
 * Next valid workday for role/user at or after fromDate, respecting global capacity + weekends/holidays.
 * Prompt 51: bounded alignment loop; warn and return best workday instead of throwing.
 */
async function scheduleStageDay(role, userId, fromDate, holidaySet) {
  let anchor = createUTCDate(nextValidWorkdayUTC(fromDate, holidaySet));
  if (!anchor) throw new Error("Invalid anchor date");
  if (!userId) return anchor;

  const maxAlign = Math.min(370, CAPACITY_MAX_SEARCH_DAYS + 5);

  for (let iter = 0; iter < maxAlign; iter++) {
    const raw = await getNextAvailableDate(role, userId, anchor);
    const d = createUTCDate(raw);
    const aligned = createUTCDate(nextValidWorkdayUTC(d, holidaySet));
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
  return createUTCDate(nextValidWorkdayUTC(anchor, holidaySet)) || anchor;
}

/**
 * Prompt 48: book n sequential calendar-backed capacity slots (e.g. shoot window).
 * After each slot, next search starts the following calendar day (per spec).
 */
async function fillMultiDaySlots(role, userId, startFrom, nDays, holidaySet) {
  const dates = [];
  let cursor = startFrom;
  for (let k = 0; k < nDays; k++) {
    const nextDate = await scheduleStageDay(role, userId, cursor, holidaySet);
    dates.push(nextDate);
    cursor = addDaysUTC(nextDate, 1);
  }
  return dates;
}

/**
 * Sequential reel generation with capacity-aware dates (Prompt 48).
 * Skips public holidays/weekends on assignable days; respects TeamCapacity across all clients.
 *
 * @param {object|string} client - Client document or client id
 */
async function generateClientReels(client) {
  const clientId = client?._id || client;
  if (!clientId) return { insertedCount: 0, endDate: null };

  const populatedClient = await Client.findById(clientId)
    .populate("package")
    .populate("team.strategist")
    .populate("team.videographer")
    .populate("team.videoEditor")
    .populate("team.postingExecutive")
    .select("startDate endDate manager createdBy package team")
    .lean();

  if (!populatedClient?.startDate) return { insertedCount: 0, endDate: null };

  const reelsCount = populatedClient?.package?.noOfReels || 0;
  if (!Number.isFinite(reelsCount) || reelsCount <= 0) {
    const start = createUTCDate(populatedClient.startDate);
    if (start) {
      await Client.updateOne({ _id: populatedClient._id }, { $set: { endDate: start } });
    }
    return { insertedCount: 0, endDate: start || null };
  }

  const startSeedDate = createUTCDate(populatedClient.startDate);
  if (!startSeedDate) return { insertedCount: 0, endDate: null };
  const baseStartDate = addDaysUTC(startSeedDate, 1);

  const estimateEnd = addDaysUTC(baseStartDate, reelsCount * 40 + 180);
  const holidaySet = await buildHolidaySetUTC(baseStartDate, estimateEnd);

  const team = populatedClient.team || {};
  const managerId = populatedClient.manager?._id || populatedClient.manager;
  const createdBy = populatedClient.createdBy || managerId;

  const strategistId = team.strategist?._id || team.strategist;
  const videographerId = team.videographer?._id || team.videographer;
  const videoEditorId = team.videoEditor?._id || team.videoEditor;
  const postingExecutiveId = team.postingExecutive?._id || team.postingExecutive;

  let insertedCount = 0;
  let lastPostingDate = null;
  const usedPostingDayKeys = new Set();

  for (let i = 1; i <= reelsCount; i++) {
    const isUrgent = i <= 2;
    // Prompt 55: urgent reels start tighter; normal reels keep wider stagger.
    const staggerOffset = isUrgent ? (i - 1) * 1 : (i - 1) * 2;
    const reelStartSeed = addDaysUTC(baseStartDate, staggerOffset);
    // Prompt 57/58 (critical): fixed per-reel anchor from stagger. Never mutated globally.
    const reelStartDate = createUTCDate(nextValidWorkdayUTC(reelStartSeed, holidaySet));
    // Stage execution dates are capacity-based and flow from previous stage outputs.
    // Only stage dates shift; the reel anchor remains locked.
    const planDue = await scheduleStageDay(
      "strategist",
      strategistId,
      reelStartDate,
      holidaySet
    );

    let shootDue;
    let editDue;
    let approvalDue;
    let postDue;

    if (isUrgent) {
      const shootStart = addDaysUTC(planDue, 1);
      const shootDates = await fillMultiDaySlots(
        "videographer",
        videographerId,
        shootStart,
        1,
        holidaySet
      );
      shootDue = shootDates[0];

      const editStart = addDaysUTC(shootDue, 1);
      const editDates = await fillMultiDaySlots(
        "videoEditor",
        videoEditorId,
        editStart,
        1,
        holidaySet
      );
      editDue = editDates[0];

      const approvalStart = editDue;
      // Prompt 44: urgent — first manager slot on or after edit day (same day if capacity allows).
      approvalDue = await scheduleStageDay("manager", managerId, approvalStart, holidaySet);

      const postStart = addDaysUTC(approvalDue, 1);
      const postDates = await fillMultiDaySlots(
        "postingExecutive",
        postingExecutiveId,
        postStart,
        1,
        holidaySet
      );
      postDue = postDates[0];
    } else {
      const shootStart = addDaysUTC(planDue, 1);
      const shootDates = await fillMultiDaySlots(
        "videographer",
        videographerId,
        shootStart,
        3,
        holidaySet
      );
      shootDue = shootDates[shootDates.length - 1];

      const editStart = addDaysUTC(shootDue, 1);
      const editDates = await fillMultiDaySlots(
        "videoEditor",
        videoEditorId,
        editStart,
        2,
        holidaySet
      );
      editDue = editDates[editDates.length - 1];

      const approvalStart = addDaysUTC(editDue, 1);
      const approvalDates = await fillMultiDaySlots(
        "manager",
        managerId,
        approvalStart,
        3,
        holidaySet
      );
      approvalDue = approvalDates[approvalDates.length - 1];

      const postStart = addDaysUTC(approvalDue, 1);
      const postDates = await fillMultiDaySlots(
        "postingExecutive",
        postingExecutiveId,
        postStart,
        1,
        holidaySet
      );
      postDue = postDates[0];
    }

    // Prompt 56: avoid client-calendar clustering by spreading post days.
    // If a day is already used by another reel of the same client batch, push forward.
    let postingKey = ymdUTC(postDue);
    while (postingKey && usedPostingDayKeys.has(postingKey)) {
      postDue = await scheduleStageDay(
        "postingExecutive",
        postingExecutiveId,
        addDaysUTC(postDue, 1),
        holidaySet
      );
      postingKey = ymdUTC(postDue);
    }
    if (postingKey) usedPostingDayKeys.add(postingKey);

    // Prompt 60: verify staggered parallel anchors vs execution outcomes.
    console.log({
      reel: i,
      reelStartDate: ymdUTC(reelStartDate),
      planDate: ymdUTC(planDue),
      postDate: ymdUTC(postDue),
    });

    const postingDate = createUTCDate(postDue);
    lastPostingDate = postingDate;

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
      plan: isUrgent ? "urgent" : "normal",
      planType: isUrgent ? "urgent" : "normal",
      title: `Reel #${i}`,
      month: toMonthStringUTC(postingDate),
      clientPostingDate: createUTCDate(postingDate),
      workflowStages,
      createdBy,
    });
    insertedCount += 1;
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
};
