const Client = require("../models/Client");
const ContentItem = require("../models/ContentItem");
const PublicHoliday = require("../models/PublicHoliday");

// Prompt 34: force date storage as pure UTC midnight.
function createUTCDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  // IMPORTANT: use local getters as specified in prompt.
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
  const day = d.getUTCDay(); // 0=Sun, 6=Sat
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

  // Safety cap: avoid infinite loops on bad input.
  for (let i = 0; i < 370; i++) {
    const key = ymdUTC(d);
    const isHoliday = key && holidays.has(key);
    if (!isWeekendUTC(d) && !isHoliday) return d;
    d = addDaysUTC(d, 1);
  }

  return d;
};

/**
 * Prompt 15: simple sequential reel generation.
 *
 * IMPORTANT:
 * - Skip public holidays (and weekends)
 * - No capacity checks
 * - No overlapping (pure sequential)
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

  // Start from next day after client.startDate
  let currentDate = createUTCDate(populatedClient.startDate);
  if (!currentDate) return { insertedCount: 0, endDate: null };
  currentDate = addDaysUTC(currentDate, 1);

  // Preload holidays for the expected scheduling window.
  // Rough upper bound: ~10 calendar days per reel (pipeline + 1-day gap), plus buffer.
  const estimateEnd = addDaysUTC(currentDate, reelsCount * 10 + 60);
  const holidaySet = await buildHolidaySetUTC(currentDate, estimateEnd);

  const team = populatedClient.team || {};
  // Approval assignment must always go to the client.manager (not campaignManager).
  const managerId = populatedClient.manager?._id || populatedClient.manager;
  const createdBy = populatedClient.createdBy || managerId;

  const items = [];
  let lastPostingDate = null;

  for (let i = 0; i < reelsCount; i++) {
    // Sequential pipeline:
    // Plan: currentDate
    // Shoot: next 3 days
    // Edit: next 2 days
    // Approval: next 3 days
    // Post: next 1 day
    const planDue = createUTCDate(nextValidWorkdayUTC(currentDate, holidaySet));
    const shootDue = createUTCDate(nextValidWorkdayUTC(addDaysUTC(planDue, 3), holidaySet));
    const editDue = createUTCDate(nextValidWorkdayUTC(addDaysUTC(shootDue, 2), holidaySet));
    const approvalDue = createUTCDate(nextValidWorkdayUTC(addDaysUTC(editDue, 3), holidaySet));
    const postDue = createUTCDate(nextValidWorkdayUTC(addDaysUTC(approvalDue, 1), holidaySet));

    const postingDate = createUTCDate(postDue);
    lastPostingDate = postingDate;

    const workflowStages = [
      {
        stageName: "Plan",
        role: "strategist",
        assignedUser: team.strategist?._id || team.strategist || undefined,
        dueDate: createUTCDate(planDue),
        status: "assigned",
      },
      {
        stageName: "Shoot",
        role: "videographer",
        assignedUser: team.videographer?._id || team.videographer || undefined,
        dueDate: createUTCDate(shootDue),
        status: "assigned",
      },
      {
        stageName: "Edit",
        role: "videoEditor",
        assignedUser: team.videoEditor?._id || team.videoEditor || undefined,
        dueDate: createUTCDate(editDue),
        status: "assigned",
      },
      {
        stageName: "Approval",
        role: "manager",
        assignedUser: populatedClient.manager?._id || populatedClient.manager || undefined,
        dueDate: createUTCDate(approvalDue),
        status: "assigned",
      },
      {
        stageName: "Post",
        role: "postingExecutive",
        assignedUser: team.postingExecutive?._id || team.postingExecutive || undefined,
        dueDate: createUTCDate(postDue),
        status: "assigned",
      },
    ];

    items.push({
      client: populatedClient._id,
      contentType: "reel",
      plan: "normal",
      title: `Reel #${i + 1}`,
      month: toMonthStringUTC(postingDate),
      clientPostingDate: createUTCDate(postingDate),
      workflowStages,
      createdBy,
    });

    // Move currentDate to the next day after postDate
    currentDate = createUTCDate(nextValidWorkdayUTC(addDaysUTC(postDue, 1), holidaySet));
  }

  if (items.length) {
    await ContentItem.insertMany(items);
  }

  if (lastPostingDate) {
    await Client.updateOne(
      { _id: populatedClient._id },
      { $set: { endDate: createUTCDate(lastPostingDate) } }
    );
  }

  return {
    insertedCount: items.length,
    endDate: lastPostingDate ? createUTCDate(lastPostingDate) : null,
  };
}

module.exports = {
  generateClientReels,
};

