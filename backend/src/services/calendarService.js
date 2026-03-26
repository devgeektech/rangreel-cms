const Client = require("../models/Client");
const PublicHoliday = require("../models/PublicHoliday");
const ContentItem = require("../models/ContentItem");
const CalendarLock = require("../models/CalendarLock");
const UserCapacity = require("../models/UserCapacity");
const mongoose = require("mongoose");

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

const isWeekendUTC = (d) => {
  const day = d.getUTCDay(); // 0=Sun, 6=Sat
  return day === 0 || day === 6;
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

const subtractWorkingDays = (fromDate, n, holidayDateSet) => {
  const start = new Date(fromDate);
  let date = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));

  if (!Number.isFinite(n) || n <= 0) return date;

  for (let i = 0; i < n; i++) {
    do {
      date = addDaysUTC(date, -1);
    } while (isWeekendUTC(date) || (holidayDateSet && holidayDateSet.has(ymdUTC(date))));
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
  // Prompt 16: approvals assigned to `client.manager` (clientManagerOnly).
  if (role === "Strategist") return client.team?.strategist?._id || client.team?.strategist;
  if (role === "Videographer") return client.team?.videographer?._id || client.team?.videographer;
  if (role === "VideoEditor") return client.team?.videoEditor?._id || client.team?.videoEditor;
  if (role === "Graphic Designer") return client.team?.graphicDesigner?._id || client.team?.graphicDesigner;
  if (role === "Manager") return client.manager?._id || client.manager;
  if (role === "Posting Executive") return client.team?.postingExecutive?._id || client.team?.postingExecutive;
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

const buildReelStages = (client, postingDate, planType) => {
  if (planType === "urgent") {
    return [
      // Urgent fast-lane: keep the full workflow through posting,
      // but compress the timeline so Videographer gets the tight window.
      // Stage due dates are spaced by 1 working day between adjacent stages.
      buildWorkflowStage("Plan", "Strategist", subtractWorkingDays(postingDate, 5, client._holidayDateSet), client),
      buildWorkflowStage("Shoot", "Videographer", subtractWorkingDays(postingDate, 4, client._holidayDateSet), client),
      buildWorkflowStage("Edit", "VideoEditor", subtractWorkingDays(postingDate, 3, client._holidayDateSet), client),
      buildWorkflowStage("Approval", "Manager", subtractWorkingDays(postingDate, 2, client._holidayDateSet), client),
      buildWorkflowStage("Approval", "Manager", subtractWorkingDays(postingDate, 1, client._holidayDateSet), client),
      buildWorkflowStage("Post", "Posting Executive", subtractWorkingDays(postingDate, 0, client._holidayDateSet), client),
    ];
  }

  return [
    buildWorkflowStage("Plan", "Strategist", subtractWorkingDays(postingDate, 10, client._holidayDateSet), client),
    buildWorkflowStage("Shoot", "Videographer", subtractWorkingDays(postingDate, 8, client._holidayDateSet), client),
    buildWorkflowStage("Shoot", "Videographer", subtractWorkingDays(postingDate, 6, client._holidayDateSet), client),
    buildWorkflowStage("Edit", "VideoEditor", subtractWorkingDays(postingDate, 5, client._holidayDateSet), client),
    buildWorkflowStage("Approval", "Manager", subtractWorkingDays(postingDate, 4, client._holidayDateSet), client),
    buildWorkflowStage("Approval", "Manager", subtractWorkingDays(postingDate, 1, client._holidayDateSet), client),
    buildWorkflowStage("Post", "Posting Executive", subtractWorkingDays(postingDate, 0, client._holidayDateSet), client),
  ];
};

const buildStaticOrCarouselStages = (client, postingDate) => {
  return [
    buildWorkflowStage("Plan", "Strategist", subtractWorkingDays(postingDate, 6, client._holidayDateSet), client),
    buildWorkflowStage("Work", "Graphic Designer", subtractWorkingDays(postingDate, 5, client._holidayDateSet), client),
    buildWorkflowStage("Approval", "Manager", subtractWorkingDays(postingDate, 4, client._holidayDateSet), client),
    buildWorkflowStage("Approval", "Manager", subtractWorkingDays(postingDate, 3, client._holidayDateSet), client),
    buildWorkflowStage("Approval", "Manager", subtractWorkingDays(postingDate, 2, client._holidayDateSet), client),
    buildWorkflowStage("Approval", "Manager", subtractWorkingDays(postingDate, 1, client._holidayDateSet), client),
    buildWorkflowStage("Post", "Posting Executive", subtractWorkingDays(postingDate, 0, client._holidayDateSet), client),
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

  const holidayDocs = await PublicHoliday.find(
    { date: { $gte: monthStart, $lt: monthEnd } },
    { date: 1 }
  );

  const holidayDateSet = new Set(holidayDocs.map((h) => ymdUTC(h.date)));

  let validWorkingDays = [];
  for (let d = new Date(monthStart); d < monthEnd; d = addDaysUTC(d, 1)) {
    if (isWeekendUTC(d)) continue;
    if (holidayDateSet.has(ymdUTC(d))) continue;
    validWorkingDays.push(new Date(d));
  }

  // Prompt 17 reshuffle validation requires stage dueDates stay within client start/end.
  // To ensure that (even for normal reels D-10 Plan), filter posting candidates such that
  // subtractWorkingDays(postingDate, 10) is not before client.startDate.
  const clientStart = normalizeUtcMidnight(populatedClient.startDate);
  const clientEnd = normalizeUtcMidnight(populatedClient.endDate);
  if (clientStart && clientEnd && validWorkingDays.length) {
    const maxPlanOffset = 10;
    const filtered = validWorkingDays.filter((d) => {
      if (d.getTime() < clientStart.getTime() || d.getTime() > clientEnd.getTime()) {
        return false;
      }
      const earliestPlan = subtractWorkingDays(d, maxPlanOffset, holidayDateSet);
      return earliestPlan.getTime() >= clientStart.getTime();
    });

    // If the strict filter removes everything, fall back to range-only filtering.
    validWorkingDays =
      filtered.length > 0
        ? filtered
        : validWorkingDays.filter((d) => d.getTime() >= clientStart.getTime() && d.getTime() <= clientEnd.getTime());
  }

  const pkg = populatedClient.package;
  const reelsCount = pkg?.noOfReels || 0;
  const staticPostsCount = pkg?.noOfStaticPosts || 0;
  const carouselsCount = pkg?.noOfCarousels || 0;

  const totalItems = reelsCount + staticPostsCount + carouselsCount;
  if (totalItems <= 0 || validWorkingDays.length <= 0) return 0;

  const spacing = Math.max(1, Math.floor(validWorkingDays.length / totalItems));
  const postingDates = [];
  for (let i = 0; i < totalItems; i++) {
    const idx = Math.min(i * spacing, validWorkingDays.length - 1);
    postingDates.push(validWorkingDays[idx]);
  }

  // attach helper data for dueDate builders
  populatedClient._holidayDateSet = holidayDateSet;

  const createdBy = populatedClient.createdBy || populatedClient.manager;

  const items = [];
  let cursor = 0;

  for (let i = 0; i < reelsCount; i++) {
    const postingDate = postingDates[cursor++];
    const urgentReelsCount = Math.ceil(reelsCount / 2);
    const isUrgent = i < urgentReelsCount; // first half reels urgent
    const planType = isUrgent ? "urgent" : "normal";

    const stages = buildReelStages(populatedClient, postingDate, planType);
    items.push({
      client: populatedClient._id,
      contentType: "reel",
      plan: planType,
      title: `Reel #${i + 1}`,
      month: targetMonth,
      clientPostingDate: postingDate,
      workflowStages: stages,
      createdBy,
    });
  }

  for (let i = 0; i < staticPostsCount; i++) {
    const postingDate = postingDates[cursor++];
    const stages = buildStaticOrCarouselStages(populatedClient, postingDate);
    items.push({
      client: populatedClient._id,
      contentType: "static_post",
      title: `Static Post #${i + 1}`,
      month: targetMonth,
      clientPostingDate: postingDate,
      workflowStages: stages,
      createdBy,
    });
  }

  for (let i = 0; i < carouselsCount; i++) {
    const postingDate = postingDates[cursor++];
    const stages = buildStaticOrCarouselStages(populatedClient, postingDate);
    items.push({
      client: populatedClient._id,
      contentType: "carousel",
      title: `Carousel #${i + 1}`,
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

const EXCLUDED_COMPLETED_STATUSES = ["submitted", "posted"];

const DEFAULT_DAILY_CAP = 7;

const capFieldForRole = (role) => {
  switch (role) {
    case "Strategist":
      return "dailyPlanCap";
    case "Videographer":
      return "dailyReelShootCap";
    case "VideoEditor":
      return "dailyReelEditCap";
    case "Graphic Designer":
      return "dailyDesignCap";
    case "Posting Executive":
      return "dailyPostCap";
    case "Manager":
      return "dailyApproveCap";
    default:
      return "dailyGeneralCap";
  }
};

const dayRangeFromYMD = (ymd) => {
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  const day = Number(m[3]);
  const start = new Date(Date.UTC(year, monthIndex, day));
  const end = addDaysUTC(start, 1);
  return { start, end };
};

const countExistingStageTasksForUserDay = async (userId, dueDayKey, cache) => {
  const key = `${String(userId)}|${dueDayKey}`;
  if (cache.has(key)) return cache.get(key);

  const range = dayRangeFromYMD(dueDayKey);
  if (!range) {
    cache.set(key, 0);
    return 0;
  }

  const userObjId = new mongoose.Types.ObjectId(String(userId));

  const result = await ContentItem.aggregate([
    { $unwind: "$workflowStages" },
    {
      $match: {
        "workflowStages.assignedUser": userObjId,
        "workflowStages.dueDate": { $gte: range.start, $lt: range.end },
        "workflowStages.status": { $nin: EXCLUDED_COMPLETED_STATUSES },
      },
    },
    { $count: "count" },
  ]);

  const count = result?.[0]?.count || 0;
  cache.set(key, count);
  return count;
};

const toMonthStringUTC = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
};

const ensureHolidaysForMonth = async (holidayDateSet, loadedMonths, monthDateUTC) => {
  const y = monthDateUTC.getUTCFullYear();
  const m = monthDateUTC.getUTCMonth(); // 0-11
  const monthKey = `${y}-${String(m + 1).padStart(2, "0")}`;
  if (loadedMonths.has(monthKey)) return;

  const monthStart = new Date(Date.UTC(y, m, 1));
  const monthEnd = new Date(Date.UTC(y, m + 1, 1));

  const holidayDocs = await PublicHoliday.find(
    { date: { $gte: monthStart, $lt: monthEnd } },
    { date: 1 }
  );

  for (const h of holidayDocs) holidayDateSet.add(ymdUTC(h.date));
  loadedMonths.add(monthKey);
};

/**
 * Forward: move `n` working days after `fromUtcMidnight` (n=0 → same calendar day).
 * Weekends and holidays (from holidayDateSet) are skipped.
 */
const addWorkingDays = async (fromUtcMidnight, n, holidayDateSet, loadedMonths) => {
  const base = normalizeUtcMidnight(fromUtcMidnight);
  if (!base || !Number.isFinite(n) || n <= 0) return base;

  let date = new Date(base);
  let moved = 0;
  let safety = 0;
  while (moved < n) {
    safety += 1;
    if (safety > 10000) break;
    date = addDaysUTC(date, 1);
    await ensureHolidaysForMonth(holidayDateSet, loadedMonths, date);
    if (!isWeekendUTC(date) && !holidayDateSet.has(ymdUTC(date))) {
      moved += 1;
    }
  }
  return normalizeUtcMidnight(date);
};

const dueDateForPipelineOffset = async (pipelineStart, offset, holidayDateSet, loadedMonths) => {
  if (offset <= 0) return normalizeUtcMidnight(pipelineStart);
  return addWorkingDays(pipelineStart, offset, holidayDateSet, loadedMonths);
};

const REEL_STAGE_DEFS_URGENT = [
  { stageName: "Plan", role: "Strategist", offset: 0 },
  { stageName: "Shoot", role: "Videographer", offset: 1 },
  { stageName: "Edit", role: "VideoEditor", offset: 2 },
  { stageName: "Approval", role: "Manager", offset: 3 },
  { stageName: "Approval", role: "Manager", offset: 3 },
  { stageName: "Post", role: "Posting Executive", offset: 3 },
];

const REEL_STAGE_DEFS_NORMAL = [
  { stageName: "Plan", role: "Strategist", offset: 0 },
  { stageName: "Shoot", role: "Videographer", offset: 2 },
  { stageName: "Shoot", role: "Videographer", offset: 4 },
  { stageName: "Edit", role: "VideoEditor", offset: 5 },
  { stageName: "Approval", role: "Manager", offset: 6 },
  { stageName: "Approval", role: "Manager", offset: 9 },
  { stageName: "Post", role: "Posting Executive", offset: 10 },
];

const STATIC_CAROUSEL_STAGE_DEFS = [
  { stageName: "Plan", role: "Strategist", offset: 0 },
  { stageName: "Work", role: "Graphic Designer", offset: 1 },
  { stageName: "Approval", role: "Manager", offset: 2 },
  { stageName: "Approval", role: "Manager", offset: 3 },
  { stageName: "Approval", role: "Manager", offset: 4 },
  { stageName: "Approval", role: "Manager", offset: 5 },
  { stageName: "Post", role: "Posting Executive", offset: 6 },
];

const collectUserIdsForCapacity = (clientDoc) => {
  const ids = new Set();
  const m = clientDoc.manager?._id || clientDoc.manager;
  if (m) ids.add(String(m));
  const t = clientDoc.team || {};
  const keys = [
    "strategist",
    "videographer",
    "videoEditor",
    "graphicDesigner",
    "postingExecutive",
    "campaignManager",
    "photographer",
  ];
  for (const k of keys) {
    const u = t[k]?._id || t[k];
    if (u) ids.add(String(u));
  }
  return [...ids];
};

/**
 * Forward-scheduling one-time package generation (Prompt 17):
 * WorkingDayStream from startDate+1; reel pipelines 4 / 11 working days; static & carousel 7; UserCapacity caps; endDate = max post date.
 */
const generateClientPackageOnce = async (client) => {
  const clientId = client?._id || client;
  const populatedClient = await populateClientForCalendar(clientId);
  if (!populatedClient) return 0;

  const pkg = populatedClient.package;
  const reelsCount = pkg?.noOfReels || 0;
  const staticPostsCount = pkg?.noOfStaticPosts || 0;
  const carouselsCount = pkg?.noOfCarousels || 0;

  const totalItems = reelsCount + staticPostsCount + carouselsCount;
  const clientStart = normalizeUtcMidnight(populatedClient.startDate);
  if (!clientStart) return 0;

  if (totalItems <= 0) {
    const emptyClient = await Client.findById(populatedClient._id);
    if (emptyClient) {
      emptyClient.endDate = clientStart;
      await emptyClient.save();
    }
    return 0;
  }

  const holidayDateSet = new Set();
  const loadedMonths = new Set();

  const userIdStrings = collectUserIdsForCapacity(populatedClient);
  const userObjectIds = userIdStrings.map((id) => new mongoose.Types.ObjectId(id));
  const capDocs = await UserCapacity.find({ user: { $in: userObjectIds } }).lean();
  const capByUser = new Map(capDocs.map((d) => [String(d.user), d]));

  const getUserDayCap = (userId, role) => {
    const doc = capByUser.get(String(userId));
    const field = capFieldForRole(role);
    const v = doc?.[field];
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : DEFAULT_DAILY_CAP;
  };

  const existingStageLoadCache = new Map();

  const scheduledLoad = new Map();
  const scheduledLoadGet = (userId, dueDayKey) => {
    const u = scheduledLoad.get(String(userId));
    return u?.get(dueDayKey) || 0;
  };
  const scheduledLoadInc = (userId, dueDayKey, delta = 1) => {
    const uid = String(userId);
    if (!scheduledLoad.has(uid)) scheduledLoad.set(uid, new Map());
    const uMap = scheduledLoad.get(uid);
    uMap.set(dueDayKey, (uMap.get(dueDayKey) || 0) + delta);
  };

  const workingStream = [];
  let calCursor = addDaysUTC(clientStart, 1);
  {
    let g = 0;
    while (g++ < 400) {
      await ensureHolidaysForMonth(holidayDateSet, loadedMonths, calCursor);
      if (!isWeekendUTC(calCursor) && !holidayDateSet.has(ymdUTC(calCursor))) {
        workingStream.push(normalizeUtcMidnight(calCursor));
        calCursor = addDaysUTC(calCursor, 1);
        break;
      }
      calCursor = addDaysUTC(calCursor, 1);
    }
  }

  const ensureStreamLength = async (minIndex) => {
    let guard = 0;
    while (workingStream.length <= minIndex && guard++ < 25000) {
      await ensureHolidaysForMonth(holidayDateSet, loadedMonths, calCursor);
      if (!isWeekendUTC(calCursor) && !holidayDateSet.has(ymdUTC(calCursor))) {
        workingStream.push(normalizeUtcMidnight(calCursor));
      }
      calCursor = addDaysUTC(calCursor, 1);
    }
  };

  const trySchedulePipeline = async ({ contentType, title, plan, stageDefs }) => {
    const maxOff = Math.max(...stageDefs.map((d) => d.offset));

    for (let startIdx = 0; startIdx < 20000; startIdx++) {
      await ensureStreamLength(startIdx + maxOff + 2);
      if (workingStream.length <= startIdx + maxOff) break;

      const pipelineStart = workingStream[startIdx];
      const stages = [];
      for (const def of stageDefs) {
        const dueDate = await dueDateForPipelineOffset(
          pipelineStart,
          def.offset,
          holidayDateSet,
          loadedMonths
        );
        stages.push(buildWorkflowStage(def.stageName, def.role, dueDate, populatedClient));
      }

      let fits = true;
      const stageDueChecks = [];
      for (const s of stages) {
        if (!s?.assignedUser || !s?.dueDate) continue;
        const userId = s.assignedUser;
        const dueDayKey = ymdUTC(new Date(s.dueDate));
        const cap = getUserDayCap(userId, s.role);
        const existingCount = await countExistingStageTasksForUserDay(userId, dueDayKey, existingStageLoadCache);
        const alreadyScheduled = scheduledLoadGet(userId, dueDayKey);
        if (existingCount + alreadyScheduled >= cap) {
          fits = false;
          break;
        }
        stageDueChecks.push({ userId, dueDayKey });
      }

      if (!fits) continue;

      for (const { userId, dueDayKey } of stageDueChecks) {
        scheduledLoadInc(userId, dueDayKey, 1);
      }

      const postStage = stages[stages.length - 1];
      const postingDate = normalizeUtcMidnight(postStage.dueDate);

      return {
        contentType,
        plan,
        title,
        month: toMonthStringUTC(postingDate),
        clientPostingDate: postingDate,
        workflowStages: stages,
      };
    }

    return null;
  };

  const createdBy = populatedClient.createdBy || populatedClient.manager;
  const items = [];

  const urgentCount = Math.ceil(reelsCount / 2);

  for (let i = 0; i < urgentCount; i++) {
    const row = await trySchedulePipeline({
      contentType: "reel",
      plan: "urgent",
      title: `Reel #${i + 1}`,
      stageDefs: REEL_STAGE_DEFS_URGENT,
    });
    if (!row) break;
    items.push({ ...row, client: populatedClient._id, createdBy });
  }

  for (let i = urgentCount; i < reelsCount; i++) {
    const row = await trySchedulePipeline({
      contentType: "reel",
      plan: "normal",
      title: `Reel #${i + 1}`,
      stageDefs: REEL_STAGE_DEFS_NORMAL,
    });
    if (!row) break;
    items.push({ ...row, client: populatedClient._id, createdBy });
  }

  for (let i = 0; i < staticPostsCount; i++) {
    const row = await trySchedulePipeline({
      contentType: "static_post",
      plan: undefined,
      title: `Static Post #${i + 1}`,
      stageDefs: STATIC_CAROUSEL_STAGE_DEFS,
    });
    if (!row) break;
    const { plan: _omitPlan, ...rest } = row;
    items.push({ ...rest, client: populatedClient._id, createdBy });
  }

  for (let i = 0; i < carouselsCount; i++) {
    const row = await trySchedulePipeline({
      contentType: "carousel",
      plan: undefined,
      title: `Carousel #${i + 1}`,
      stageDefs: STATIC_CAROUSEL_STAGE_DEFS,
    });
    if (!row) break;
    const { plan: _omitPlan2, ...rest } = row;
    items.push({ ...rest, client: populatedClient._id, createdBy });
  }

  if (!items.length) return 0;

  await ContentItem.insertMany(items);

  let maxPostMs = null;
  for (const it of items) {
    const t = new Date(it.clientPostingDate).getTime();
    if (!Number.isFinite(t)) continue;
    maxPostMs = maxPostMs === null ? t : Math.max(maxPostMs, t);
  }

  const c = await Client.findById(populatedClient._id);
  if (c && maxPostMs !== null) {
    c.endDate = new Date(maxPostMs);
    await c.save();
  }

  return items.length;
};

module.exports = {
  generateMonth,
  generateNextMonth,
  generateClientPackageOnce,
};

