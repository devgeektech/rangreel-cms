const Client = require("../models/Client");
const ContentItem = require("../models/ContentItem");
const CalendarLock = require("../models/CalendarLock");

const ymdUTC = (d) => {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDaysUTC = (d, days) => {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const normalizeMonthTarget = (targetMonth) => {
  if (!targetMonth) return null;
  const m = String(targetMonth).match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]); // 1-12
  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12)
    return null;
  return { year, month };
};

/**
 * Prompt 22: simplified scheduling.
 * Use plain calendar-day offsets (no working-day stream, no holidays).
 */
const subtractDaysUTC = (fromDate, n) => {
  const start = new Date(fromDate);
  let date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));

  if (!Number.isFinite(n) || n <= 0) return date;

  for (let i = 0; i < n; i++) {
    date = addDaysUTC(date, -1);
  }

  return date;
};

const normalizeUtcMidnight = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

const populateClientForCalendar = async (clientId) => {
  return Client.findById(clientId)
    .populate("package")
    .populate("team.strategist")
    .populate("team.videographer")
    .populate("team.videoEditor")
    .populate("team.graphicDesigner")
    .populate("team.postingExecutive")
    .populate("team.campaignManager")
    .populate("team.photographer");
};

const getAssignedUserIdForRole = (client, role) => {
  // Simplified role mapping (Prompt 17)
  if (role === "strategist") return client.team?.strategist?._id || client.team?.strategist;
  if (role === "videographer") return client.team?.videographer?._id || client.team?.videographer;
  if (role === "videoEditor") return client.team?.videoEditor?._id || client.team?.videoEditor;
  if (role === "manager") return client.manager?._id || client.manager;
  if (role === "postingExecutive") return client.team?.postingExecutive?._id || client.team?.postingExecutive;
  return undefined;
};

const buildWorkflowStage = (stageName, role, dueDate, client) => {
  const assignedUser = getAssignedUserIdForRole(client, role);
  return {
    stageName,
    role,
    assignedUser,
    dueDate,
  };
};

const buildReelStages = (client, postingDate) => {
  return [
    buildWorkflowStage("Plan", "strategist", subtractDaysUTC(postingDate, 10), client),
    buildWorkflowStage("Shoot", "videographer", subtractDaysUTC(postingDate, 8), client),
    buildWorkflowStage("Edit", "videoEditor", subtractDaysUTC(postingDate, 5), client),
    buildWorkflowStage("Approval", "manager", subtractDaysUTC(postingDate, 1), client),
    buildWorkflowStage("Post", "postingExecutive", subtractDaysUTC(postingDate, 0), client),
  ];
};

const generateMonth = async (client, targetMonth) => {
  const normalized = normalizeMonthTarget(targetMonth);
  if (!normalized) return 0;
  const { year, month } = normalized;

  const clientId = client?._id || client;
  const populatedClient = await populateClientForCalendar(clientId);
  if (!populatedClient) return 0;

  const alreadyLocked = await CalendarLock.findOne({ client: populatedClient._id, month: targetMonth });
  if (alreadyLocked) return 0;

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 1));

  const pkg = populatedClient.package;
  const reelsCount = pkg?.noOfReels || 0;
  if (reelsCount <= 0) return 0;

  const createdBy = populatedClient.createdBy || populatedClient.manager;

  const items = [];

  // Simplified posting dates:
  // - Reel-only generation
  // - One reel per calendar day starting from max(client.startDate, monthStart)
  // - No holidays/weekends logic, no capacity checks, no parallel scheduling.
  const clientStart = normalizeUtcMidnight(populatedClient.startDate) || normalizeUtcMidnight(monthStart);
  const clientEnd = normalizeUtcMidnight(populatedClient.endDate);
  const start = clientStart && clientStart.getTime() > monthStart.getTime() ? clientStart : monthStart;

  for (let i = 0; i < reelsCount; i++) {
    const postingDate = addDaysUTC(start, i);
    if (postingDate.getTime() >= monthEnd.getTime()) break;
    if (clientEnd && postingDate.getTime() > clientEnd.getTime()) break;

    const stages = buildReelStages(populatedClient, postingDate);
    items.push({
      client: populatedClient._id,
      contentType: "reel",
      plan: "normal",
      title: `Reel #${i + 1}`,
      month: targetMonth,
      clientPostingDate: postingDate,
      workflowStages: stages,
      createdBy,
    });
  }

  if (!items.length) return 0;

  // Create the lock right before insertion to avoid "locking" empty months.
  // If another worker already locked the month, treat it as a no-op.
  try {
    await CalendarLock.create({
      client: populatedClient._id,
      month: targetMonth,
      lockedBy: createdBy,
    });
  } catch (err) {
    if (err && err.code === 11000) return 0;
    throw err;
  }

  const inserted = await ContentItem.insertMany(items);

  // Best-effort: keep client.endDate aligned to the latest posting date we generated.
  const latestPosting = items[items.length - 1]?.clientPostingDate;
  if (latestPosting) {
    await Client.updateOne(
      { _id: populatedClient._id },
      { $set: { endDate: normalizeUtcMidnight(latestPosting) } }
    );
  }

  return inserted.length;
};

const generateNextMonth = async (client) => {
  const clientId = client?._id || client;
  const startClient = await Client.findById(clientId);
  if (!startClient) return 0;

  const latest = await ContentItem.findOne({ client: clientId }).sort({ month: -1 });
  let nextMonth;

  if (!latest) {
    const d = startClient.startDate || new Date();
    const year = d.getUTCFullYear();
    const month = d.getUTCMonth() + 1;
    const next = new Date(Date.UTC(year, month, 1)); // next month
    nextMonth = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
  } else {
    const [y, m] = String(latest.month).split("-");
    const year = Number(y);
    const monthIndex = Number(m) - 1; // 0-11
    const next = new Date(Date.UTC(year, monthIndex + 1, 1));
    nextMonth = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  const existing = await ContentItem.findOne({ client: clientId, month: nextMonth });
  if (existing) return 0;

  return generateMonth(startClient, nextMonth);
};

/**
 * Prompt 22: simplified one-time package generation.
 * Kept to avoid breaking the system, but it now delegates to the simplified monthly generator.
 * No urgent logic, no static/carousel scheduling, no capacity checks, no holidays/working-day stream.
 */
const generateClientPackageOnce = async (client) => {
  const clientId = client?._id || client;
  const c = await Client.findById(clientId).select("startDate").lean();
  const d = c?.startDate ? new Date(c.startDate) : null;
  if (!d || Number.isNaN(d.getTime())) return 0;
  const targetMonth = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  return generateMonth(clientId, targetMonth);
};

module.exports = {
  generateMonth,
  generateNextMonth,
  generateClientPackageOnce,
};

