const ContentItem = require("../models/ContentItem");
const Schedule = require("../models/Schedule");
const Client = require("../models/Client");
const { getCustomMonthRange, normalizeUtcMidnight } = require("./customMonthRange.service");

function ymdUTC(d) {
  const x = normalizeUtcMidnight(d);
  if (!x) return "";
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, "0")}-${String(
    x.getUTCDate()
  ).padStart(2, "0")}`;
}

function getDaysBetween(start, end) {
  const diff = new Date(end) - new Date(start);
  return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;
}

function resolveMonthTotals(client) {
  const plan = client?.activeContentCounts || {};
  const pkg = client?.package || {};
  const totalReels =
    Number(client?.totalReels) ||
    Number(plan?.noOfReels) ||
    Number(pkg?.noOfReels) ||
    0;
  const totalPosts =
    Number(client?.totalPosts) ||
    Number(plan?.noOfStaticPosts) ||
    (Number(pkg?.noOfPosts) || 0) + (Number(pkg?.noOfStaticPosts) || 0);
  const totalCarousels =
    Number(client?.totalCarousels) ||
    Number(plan?.noOfCarousels) ||
    Number(pkg?.noOfCarousels) ||
    0;
  return {
    totalReels: Math.max(0, totalReels),
    totalPosts: Math.max(0, totalPosts),
    totalCarousels: Math.max(0, totalCarousels),
  };
}

/**
 * Independent month generation: evenly distribute counts over range days with no week locks.
 */
async function generateScheduleForRange(client, range) {
  const clientId = client?._id || client;
  const start = normalizeUtcMidnight(range.start);
  const end = normalizeUtcMidnight(range.end);
  if (!start || !end) return [];

  const hydratedClient =
    client && typeof client === "object" && (client.activeContentCounts || client.package)
      ? client
      : await Client.findById(clientId)
          .populate("package")
          .select("activeContentCounts package totalReels totalPosts totalCarousels")
          .lean();
  if (!hydratedClient) return [];

  const { totalReels, totalPosts, totalCarousels } = resolveMonthTotals(hydratedClient);
  const totalDays = getDaysBetween(start, end);
  if (totalDays <= 0) return [];

  const calendarDays = [];
  let current = new Date(start);
  while (current <= end) {
    calendarDays.push(new Date(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }

  const calendarMap = {};
  calendarDays.forEach((date) => {
    calendarMap[ymdUTC(date)] = [];
  });

  const reelGap = totalReels > 0 ? Math.max(1, Math.floor(totalDays / totalReels)) : 1;
  const postGap = totalPosts > 0 ? Math.max(1, Math.floor(totalDays / totalPosts)) : 1;
  const carouselGap = totalCarousels > 0 ? Math.max(1, Math.floor(totalDays / totalCarousels)) : 1;

  let reelPointer = 0;
  for (let i = 0; i < totalReels; i += 1) {
    const index = Math.min(reelPointer, calendarDays.length - 1);
    const key = ymdUTC(calendarDays[index]);
    calendarMap[key].push({ type: "reel" });
    reelPointer += reelGap;
  }

  let postPointer = 0;
  for (let i = 0; i < totalPosts; i += 1) {
    const index = Math.min(postPointer, calendarDays.length - 1);
    const key = ymdUTC(calendarDays[index]);
    calendarMap[key].push({ type: "post" });
    postPointer += postGap;
  }

  let carouselPointer = 0;
  for (let i = 0; i < totalCarousels; i += 1) {
    const index = Math.min(carouselPointer, calendarDays.length - 1);
    const key = ymdUTC(calendarDays[index]);
    calendarMap[key].push({ type: "carousel" });
    carouselPointer += carouselGap;
  }

  const sourceRows = await ContentItem.find({ client: clientId, type: { $in: ["reel", "post", "carousel"] } })
    .select("_id title type")
    .sort({ createdAt: 1 })
    .lean();
  const pools = {
    reel: sourceRows.filter((r) => r.type === "reel"),
    post: sourceRows.filter((r) => r.type === "post"),
    carousel: sourceRows.filter((r) => r.type === "carousel"),
  };
  const cursors = { reel: 0, post: 0, carousel: 0 };

  const items = [];
  Object.keys(calendarMap).forEach((date) => {
    calendarMap[date].forEach((entry) => {
      const pool = pools[entry.type] || [];
      if (!pool.length) return;
      const idx = cursors[entry.type] % pool.length;
      cursors[entry.type] += 1;
      const row = pool[idx];
      items.push({
        contentItem: row._id,
        title: row.title || "",
        postingDate: normalizeUtcMidnight(date),
      });
    });
  });

  return items;
}

/**
 * First 3 custom months after package / client creation. Idempotent if rows already exist.
 */
async function createInitialScheduleForClient(clientId) {
  const existing = await Schedule.countDocuments({ clientId });
  if (existing > 0) {
    return { created: 0, skipped: true };
  }

  const client = await Client.findById(clientId)
    .populate("package")
    .select("startDate isCustomCalendar activeContentCounts package totalReels totalPosts totalCarousels")
    .lean();
  if (!client) {
    return { created: 0, skipped: true };
  }

  const docs = [];
  for (let i = 0; i < 3; i++) {
    const range = getCustomMonthRange(client.startDate, i);
    const items = await generateScheduleForRange(client, range);
    docs.push({
      clientId,
      monthIndex: i,
      startDate: range.start,
      endDate: range.end,
      items,
      isEditable: true,
      isCustomCalendar: Boolean(client.isCustomCalendar),
    });
  }

  await Schedule.insertMany(docs);
  return { created: docs.length, skipped: false };
}

async function listSchedulesForClient(clientId) {
  let totalMonths = await Schedule.countDocuments({ clientId });
  // No rows yet: always create the 3 anchored custom months (items may be empty per range).
  if (totalMonths === 0) {
    try {
      await createInitialScheduleForClient(clientId);
    } catch (err) {
      const dup =
        err?.code === 11000 ||
        (Array.isArray(err?.writeErrors) && err.writeErrors.some((w) => w.code === 11000));
      if (!dup) throw err;
    }
    totalMonths = await Schedule.countDocuments({ clientId });
  }

  const schedules = await Schedule.find({ clientId }).sort({ monthIndex: 1 }).lean();
  const canCreateNextMonth = totalMonths >= 3;

  const clientForGeneration = await Client.findById(clientId)
    .populate("package")
    .select("activeContentCounts package totalReels totalPosts totalCarousels")
    .lean();
  const schedulesWithFreshItems = await Promise.all(
    schedules.map(async (s) => {
      const items = await generateScheduleForRange(clientForGeneration || { _id: clientId }, {
        start: s.startDate,
        end: s.endDate,
      });
      return { ...s, items };
    })
  );

  return { schedules: schedulesWithFreshItems, totalMonths, canCreateNextMonth };
}

/**
 * Manual “next month” after the first 3. Anchors from client.startDate + nextIndex (not “today”).
 */
async function createNextMonthSchedule(clientId, managerUserId) {
  const client = await Client.findOne({ _id: clientId, manager: managerUserId })
    .populate("package")
    .select("startDate isCustomCalendar activeContentCounts package totalReels totalPosts totalCarousels")
    .lean();
  if (!client) {
    throw new Error("Client not found or access denied");
  }

  const lastMonth = await Schedule.findOne({ clientId }).sort({ monthIndex: -1 }).lean();
  if (!lastMonth) {
    throw new Error("No schedule found");
  }

  const nextIndex = lastMonth.monthIndex + 1;

  const exists = await Schedule.findOne({ clientId, monthIndex: nextIndex }).lean();
  if (exists) {
    throw new Error("Month already exists");
  }

  const range = getCustomMonthRange(client.startDate, nextIndex);
  const items = await generateScheduleForRange(client, range);

  const doc = await Schedule.create({
    clientId,
    monthIndex: nextIndex,
    startDate: range.start,
    endDate: range.end,
    items,
    isEditable: true,
    isCustomCalendar: Boolean(client.isCustomCalendar),
  });

  return doc;
}

module.exports = {
  getCustomMonthRange,
  generateScheduleForRange,
  createInitialScheduleForClient,
  listSchedulesForClient,
  createNextMonthSchedule,
};
