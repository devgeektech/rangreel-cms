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

function addDaysUTC(d, days) {
  const x = normalizeUtcMidnight(d);
  if (!x) return null;
  x.setUTCDate(x.getUTCDate() + days);
  return x;
}

function enumerateDays(start, end) {
  const days = [];
  let cur = normalizeUtcMidnight(start);
  const last = normalizeUtcMidnight(end);
  if (!cur || !last) return days;
  while (cur <= last) {
    days.push(normalizeUtcMidnight(cur));
    cur = addDaysUTC(cur, 1);
  }
  return days;
}

function splitIntoWeeks(days) {
  const weeks = [];
  let current = [];
  for (const day of days || []) {
    if (!day) continue;
    if (current.length === 0) {
      current.push(day);
      continue;
    }
    const dow = day.getUTCDay();
    if (dow === 1) {
      weeks.push(current);
      current = [day];
    } else {
      current.push(day);
    }
  }
  if (current.length) weeks.push(current);
  return weeks;
}

function shuffleContent(reels, posts, carousels) {
  const combined = [];
  const r = [...(reels || [])];
  const p = [...(posts || [])];
  const c = [...(carousels || [])];
  while (r.length || p.length || c.length) {
    if (r.length) combined.push({ type: "reel", item: r.shift() });
    if (p.length) combined.push({ type: "post", item: p.shift() });
    if (c.length) combined.push({ type: "carousel", item: c.shift() });
  }
  return combined;
}

function ensureMinimum(week, type, minWanted, pool, dayMap) {
  const list = Array.isArray(week) ? week : [];
  if (!list.length || !pool?.length) return 0;
  const want = Math.min(Number(minWanted) || 0, pool.length);
  if (want <= 0) return 0;
  const gap = Math.max(1, Math.floor(list.length / want));
  let ptr = 0;
  let placed = 0;
  for (let i = 0; i < want && pool.length > 0; i += 1) {
    const idx = Math.min(ptr, list.length - 1);
    const key = ymdUTC(list[idx]);
    dayMap[key].items.push({ type, item: pool.shift() });
    ptr += gap;
    placed += 1;
  }
  return placed;
}

/**
 * SINGLE SOURCE OF TRUTH for monthly schedule generation.
 * Returns [{ date, items: [{ type, item }] }], with strict in-range assignment.
 */
function generateMonthlySchedule({
  startDate,
  endDate,
  reelsCount,
  postsCount,
  carouselCount,
  rules = {},
}) {
  const start = normalizeUtcMidnight(startDate);
  const end = normalizeUtcMidnight(endDate);
  if (!start || !end || start > end) return [];

  const weekendOff = rules.weekendOff !== false;
  const maxPerDay = Math.max(0, Number(rules.maxPerDay) || 0);
  const strictCycleEnd = addDaysUTC(start, 29);
  const boundedEnd = strictCycleEnd && strictCycleEnd < end ? strictCycleEnd : end;
  const allDays = enumerateDays(start, boundedEnd);
  const validDays = weekendOff
    ? allDays.filter((d) => {
        const dow = d.getUTCDay();
        return dow !== 0 && dow !== 6;
      })
    : allDays;
  const days = validDays.length ? validDays : allDays;
  if (!days.length) return [];

  const dayMap = {};
  for (const d of days) {
    const k = ymdUTC(d);
    dayMap[k] = { date: d, items: [] };
  }

  const reelsPool = Array.from({ length: Math.max(0, Number(reelsCount) || 0) }, (_, i) => ({ idx: i + 1 }));
  const postsPool = Array.from({ length: Math.max(0, Number(postsCount) || 0) }, (_, i) => ({ idx: i + 1 }));
  const carouselPool = Array.from({ length: Math.max(0, Number(carouselCount) || 0) }, (_, i) => ({ idx: i + 1 }));

  const weeks = splitIntoWeeks(days);
  for (const week of weeks) {
    ensureMinimum(week, "reel", 2, reelsPool, dayMap);
    ensureMinimum(week, "post", 2, postsPool, dayMap);
    ensureMinimum(week, "carousel", 2, carouselPool, dayMap);
  }

  const shuffledItems = shuffleContent(reelsPool, postsPool, carouselPool);
  let pointer = 0;
  for (const entry of shuffledItems) {
    let guard = 0;
    while (guard < days.length * 2) {
      const idx = pointer % days.length;
      const day = days[idx];
      const key = ymdUTC(day);
      if (maxPerDay > 0 && dayMap[key].items.length >= maxPerDay) {
        pointer += 1;
        guard += 1;
        continue;
      }
      dayMap[key].items.push(entry);
      pointer += 1;
      break;
    }
  }

  const out = Object.values(dayMap).sort((a, b) => a.date.getTime() - b.date.getTime());
  const countItems = (type) =>
    out.reduce((n, row) => n + row.items.filter((x) => x.type === type).length, 0);
  console.log({
    reels: countItems("reel"),
    posts: countItems("post"),
    carousels: countItems("carousel"),
  });
  return out;
}

function resolveMonthTotals(client) {
  const pkg = client?.package || {};
  const totalReels = Number(pkg?.noOfReels) || Number(client?.totalReels) || 0;
  const totalPosts =
    (Number(pkg?.noOfPosts) || 0) + (Number(pkg?.noOfStaticPosts) || 0) || Number(client?.totalPosts) || 0;
  const totalCarousels = Number(pkg?.noOfCarousels) || Number(client?.totalCarousels) || 0;
  return {
    totalReels: Math.max(0, totalReels),
    totalPosts: Math.max(0, totalPosts),
    totalCarousels: Math.max(0, totalCarousels),
  };
}

function daysDiffUtc(a, b) {
  const da = normalizeUtcMidnight(a);
  const db = normalizeUtcMidnight(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

function isWeekendDate(d) {
  const x = normalizeUtcMidnight(d);
  if (!x) return false;
  const dow = x.getUTCDay();
  return dow === 0 || dow === 6;
}

function previousWeekdayUTC(d) {
  let x = normalizeUtcMidnight(d);
  if (!x) return null;
  for (let i = 0; i < 7; i += 1) {
    if (!isWeekendDate(x)) return x;
    x = addDaysUTC(x, -1);
  }
  return x;
}

async function generateScheduleForRange(client, range, options = {}) {
  const clientId = client?._id || client;
  const start = normalizeUtcMidnight(range.start);
  const end = normalizeUtcMidnight(range.end);
  if (!start || !end) return [];

  const hydratedClient =
    client && typeof client === "object" && (client.activeContentCounts || client.package)
      ? client
      : await Client.findById(clientId)
          .populate("package")
          .select("activeContentCounts package totalReels totalPosts totalCarousels weekendEnabled rules")
          .lean();
  if (!hydratedClient) return [];

  const { totalReels, totalPosts, totalCarousels } = resolveMonthTotals(hydratedClient);
  const monthly = generateMonthlySchedule({
    startDate: start,
    endDate: end,
    reelsCount: totalReels,
    postsCount: totalPosts,
    carouselCount: totalCarousels,
    rules: {
      weekendOff:
        options?.forceWeekendOff === true ? true : hydratedClient?.weekendEnabled !== true,
      maxPerDay: hydratedClient?.rules?.maxPerDay,
    },
  });

  const sourceRows = await ContentItem.find({ client: clientId, type: { $in: ["reel", "post", "carousel"] } })
    .select("_id title type clientPostingDate workflowStages")
    .sort({ createdAt: 1 })
    .lean();
  const pools = {
    reel: sourceRows.filter((r) => r.type === "reel"),
    post: sourceRows.filter((r) => r.type === "post"),
    carousel: sourceRows.filter((r) => r.type === "carousel"),
  };
  const cursors = { reel: 0, post: 0, carousel: 0 };

  const items = [];
  for (const day of monthly) {
    for (const entry of day.items || []) {
      const pool = pools[entry.type] || [];
      if (!pool.length) continue;
      const idx = cursors[entry.type] % pool.length;
      cursors[entry.type] += 1;
      const row = pool[idx];
      const postingDate = normalizeUtcMidnight(day.date);
      const srcPost = normalizeUtcMidnight(row?.clientPostingDate || postingDate);
      const stages = Array.isArray(row?.workflowStages)
        ? row.workflowStages.map((s) => {
            const due = normalizeUtcMidnight(s?.dueDate || srcPost);
            const beforeDays = daysDiffUtc(due, srcPost);
            let stageDate = addDaysUTC(postingDate, -beforeDays);
            if (options?.forceWeekendOff === true) {
              stageDate = previousWeekdayUTC(stageDate) || stageDate;
            }
            return {
              name: s?.stageName || "",
              role: s?.role || "",
              assignedUser: s?.assignedUser || null,
              date: stageDate,
              status: s?.status || "assigned",
            };
          })
        : [];
      items.push({
        contentItem: row._id,
        title: row.title || "",
        type: row.type || entry.type,
        postingDate,
        stages,
      });
    }
  }

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
    .select("startDate isCustomCalendar activeContentCounts package totalReels totalPosts totalCarousels weekendEnabled rules")
    .lean();
  if (!client) {
    return { created: 0, skipped: true };
  }

  const docs = [];
  for (let i = 0; i < 3; i++) {
    const range = getCustomMonthRange(client.startDate, i);
    const items = await generateScheduleForRange(client, range, { forceWeekendOff: true });
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
  // Return persisted rows as source of truth so draft/custom edits remain saved.
  return { schedules, totalMonths, canCreateNextMonth };
}

/**
 * Manual “next month” after the first 3. Anchors from client.startDate + nextIndex (not “today”).
 */
async function createNextMonthSchedule(clientId, managerUserId) {
  const client = await Client.findOne({ _id: clientId, manager: managerUserId })
    .populate("package")
    .select("startDate isCustomCalendar activeContentCounts package totalReels totalPosts totalCarousels weekendEnabled rules")
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
  const items = await generateScheduleForRange(client, range, { forceWeekendOff: true });

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

async function extendSchedules(clientId, managerUserId, numberOfCycles, options = {}) {
  return previewExtendSchedules(clientId, managerUserId, numberOfCycles, options);
}

async function previewExtendSchedules(clientId, managerUserId, numberOfCycles, options = {}) {
  const n = Number(numberOfCycles);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("numberOfCycles must be a positive number");
  }
  const client = await Client.findOne({ _id: clientId, manager: managerUserId })
    .populate("package")
    .select("startDate isCustomCalendar activeContentCounts package totalReels totalPosts totalCarousels weekendEnabled rules")
    .lean();
  if (!client) throw new Error("Client not found or access denied");

  const startIndexFromInput = Number(options?.startMonthIndex);
  let startIndex;
  if (Number.isFinite(startIndexFromInput) && startIndexFromInput >= 0) {
    startIndex = Math.floor(startIndexFromInput);
  } else {
    const lastSchedule = await Schedule.findOne({ clientId }).sort({ monthIndex: -1 }).lean();
    if (!lastSchedule) throw new Error("No schedule found");
    startIndex = Number(lastSchedule.monthIndex) + 1;
  }

  const existing = await Schedule.find({
    clientId,
    monthIndex: { $gte: startIndex, $lt: startIndex + n },
  })
    .select("monthIndex")
    .lean();
  if (existing.length > 0) {
    throw new Error("Some months already exist");
  }

  const newSchedules = [];
  for (let i = 0; i < n; i += 1) {
    const monthIndex = startIndex + i;
    const range = getCustomMonthRange(client.startDate, monthIndex);
    const items = await generateScheduleForRange(client, range, { forceWeekendOff: true });
    newSchedules.push({
      clientId,
      monthIndex,
      startDate: range.start,
      endDate: range.end,
      items,
      isEditable: true,
      isCustomCalendar: Boolean(client.isCustomCalendar),
      editedByManager: false,
      isDraft: true,
    });
  }
  return newSchedules;
}

async function saveExtendedSchedules(clientId, managerUserId, schedules) {
  const client = await Client.findOne({ _id: clientId, manager: managerUserId }).select("_id").lean();
  if (!client) throw new Error("Client not found or access denied");
  if (!Array.isArray(schedules) || schedules.length === 0) throw new Error("schedules is required");

  const monthIndexes = schedules
    .map((s) => Number(s?.monthIndex))
    .filter((n) => Number.isFinite(n) && n >= 0);
  if (!monthIndexes.length) throw new Error("Invalid monthIndex");

  const existing = await Schedule.find({ clientId, monthIndex: { $in: monthIndexes } })
    .select("monthIndex")
    .lean();
  if (existing.length > 0) throw new Error("Some months already exist");

  const rows = schedules.map((s) => ({
    clientId,
    monthIndex: Number(s.monthIndex),
    startDate: normalizeUtcMidnight(s.startDate),
    endDate: normalizeUtcMidnight(s.endDate),
    items: Array.isArray(s.items) ? s.items : [],
    isEditable: s.isEditable !== false,
    isCustomCalendar: Boolean(s.isCustomCalendar),
    editedByManager: Boolean(s.editedByManager),
    isDraft: false,
  }));
  return Schedule.insertMany(rows);
}

module.exports = {
  getCustomMonthRange,
  generateScheduleForRange,
  generateMonthlySchedule,
  createInitialScheduleForClient,
  listSchedulesForClient,
  createNextMonthSchedule,
  extendSchedules,
  previewExtendSchedules,
  saveExtendedSchedules,
};
