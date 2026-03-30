const PublicHoliday = require("../models/PublicHoliday");
const {
  getNextAvailableDate,
  MAX_SEARCH_DAYS: CAPACITY_MAX_SEARCH_DAYS,
} = require("./capacityAvailability.service");
const {
  generateWorkflowStagesFromPostingDate,
  BACKWARD_OFFSETS,
} = require("./workflowFromPostingDate.service");

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

const ymdUTC = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
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
 * Next valid workday for role/user at or after fromDate, respecting capacity + weekends/holidays.
 * Mirrors the implementation in `simpleCalendar.service.js` (subset needed for posting-day scheduling).
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
    if (!aligned) return anchor;
    if (aligned.getTime() === d.getTime()) return d;
    anchor = aligned;
  }

  return createUTCDate(nextValidWorkdayUTC(anchor, holidaySet)) || anchor;
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

function roleToTeamKey(role) {
  if (role === "strategist") return "strategist";
  if (role === "videographer") return "videographer";
  if (role === "videoEditor") return "videoEditor";
  if (role === "graphicDesigner") return "graphicDesigner";
  if (role === "manager") return "manager";
  if (role === "postingExecutive") return "postingExecutive";
  return null;
}

function pickAssignedUserId(teamForType, role) {
  if (!teamForType || !role) return undefined;
  const key = roleToTeamKey(role);
  if (!key) return undefined;
  return teamForType[key];
}

function maxDaysBeforePost(offsets) {
  if (!Array.isArray(offsets)) return 0;
  return offsets.reduce((m, row) => Math.max(m, Number(row.daysBeforePost) || 0), 0);
}

/**
 * Generate a draft calendar purely in-memory (no DB writes).
 * Auto flow: schedule posting day using capacity-aware `postingExecutive`,
 * then generate all workflow stage dates by backward calculation from posting day.
 */
async function generateCalendarDraft({
  packageCounts,
  startDate,
  team,
  contentEnabled = {},
}) {
  const reelsCount = contentEnabled.reels === false ? 0 : Number(packageCounts.noOfReels) || 0;
  const postsCount =
    contentEnabled.posts === false
      ? 0
      : (Number(packageCounts.noOfPosts) || 0) + (Number(packageCounts.noOfStaticPosts) || 0);
  const carouselsCount =
    contentEnabled.carousel === false ? 0 : Number(packageCounts.noOfCarousels) || 0;

  const activeContentCounts = {
    noOfReels: reelsCount,
    noOfStaticPosts: postsCount,
    noOfCarousels: carouselsCount,
  };

  const total = reelsCount + postsCount + carouselsCount;
  if (!Number.isFinite(total) || total <= 0) {
    return { items: [], endDate: null, activeContentCounts };
  }

  const baseStart = createUTCDate(startDate);
  if (!baseStart) {
    throw new Error("Invalid startDate");
  }

  // Match the backend generator's "next working day" convention.
  const baseStartDate = addDaysUTC(baseStart, 1);

  const reelsMaxOffset = maxDaysBeforePost(BACKWARD_OFFSETS.reel);
  const postMaxOffset = maxDaysBeforePost(BACKWARD_OFFSETS.post);

  // Holidays window only needs to cover the posting schedule.
  const latestPostingCursor = addDaysUTC(
    baseStartDate,
    (reelsCount + postsCount + carouselsCount) * 10 + Math.max(reelsMaxOffset, postMaxOffset) + 90
  );
  const holidaySet = await buildHolidaySetUTC(baseStartDate, latestPostingCursor);

  const reelTeam = getTeamForContentType(team, "reel");
  const postTeam = getTeamForContentType(team, "post");
  const carouselTeam = getTeamForContentType(team, "carousel");

  let lastPostingDate = null;
  const usedReelPostingDayKeys = new Set();
  const usedPostPostingDayKeys = new Set();
  const usedCarouselPostingDayKeys = new Set();

  const keepLatestPosting = (d) => {
    const cur = createUTCDate(d);
    if (!cur) return;
    if (!lastPostingDate || cur.getTime() > lastPostingDate.getTime()) lastPostingDate = cur;
  };

  const items = [];

  // -----------------------------------
  // Reels
  // -----------------------------------
  for (let i = 1; i <= reelsCount; i++) {
    const isUrgent = i <= 2;
    const staggerOffset = isUrgent ? (i - 1) * 1 : (i - 1) * 2;
    const postingExecutiveId = pickAssignedUserId(reelTeam, "postingExecutive");

    let cursor = addDaysUTC(baseStartDate, reelsMaxOffset + staggerOffset);
    let postingDue = await scheduleStageDay(
      "postingExecutive",
      postingExecutiveId,
      cursor,
      holidaySet
    );

    let postingKey = ymdUTC(postingDue);
    while (postingKey && usedReelPostingDayKeys.has(postingKey)) {
      postingDue = await scheduleStageDay(
        "postingExecutive",
        postingExecutiveId,
        addDaysUTC(postingDue, 1),
        holidaySet
      );
      postingKey = ymdUTC(postingDue);
    }
    if (postingKey) usedReelPostingDayKeys.add(postingKey);

    const { postingDate, stages } = generateWorkflowStagesFromPostingDate(
      postingDue,
      "reel"
    );
    keepLatestPosting(postingDue);

    const stagesFinal = stages.map((s) => ({
      name: s.stageName,
      role: s.role,
      assignedUser: pickAssignedUserId(reelTeam, s.role),
      date: s.date,
      status: "assigned",
    }));

    items.push({
      contentId: `Reel #${i}`,
      title: `Reel #${i}`,
      type: "reel",
      plan: isUrgent ? "urgent" : "normal",
      planType: isUrgent ? "urgent" : "normal",
      postingDate,
      stages: stagesFinal,
    });
  }

  // -----------------------------------
  // Static Posts
  // -----------------------------------
  for (let i = 1; i <= postsCount; i++) {
    const staggerOffset = (i - 1) * 2;
    const postingExecutiveId = pickAssignedUserId(postTeam, "postingExecutive");

    let cursor = addDaysUTC(baseStartDate, postMaxOffset + staggerOffset);
    let postingDue = await scheduleStageDay(
      "postingExecutive",
      postingExecutiveId,
      cursor,
      holidaySet
    );

    let postingKey = ymdUTC(postingDue);
    while (postingKey && usedPostPostingDayKeys.has(postingKey)) {
      postingDue = await scheduleStageDay(
        "postingExecutive",
        postingExecutiveId,
        addDaysUTC(postingDue, 1),
        holidaySet
      );
      postingKey = ymdUTC(postingDue);
    }
    if (postingKey) usedPostPostingDayKeys.add(postingKey);

    const { postingDate, stages } = generateWorkflowStagesFromPostingDate(
      postingDue,
      "post"
    );
    keepLatestPosting(postingDue);

    const stagesFinal = stages.map((s) => ({
      name: s.stageName,
      role: s.role,
      assignedUser: pickAssignedUserId(postTeam, s.role),
      date: s.date,
      status: "assigned",
    }));

    items.push({
      contentId: `Post #${i}`,
      title: `Post #${i}`,
      type: "post",
      plan: "normal",
      planType: "normal",
      postingDate,
      stages: stagesFinal,
    });
  }

  // -----------------------------------
  // Carousel
  // -----------------------------------
  for (let i = 1; i <= carouselsCount; i++) {
    const staggerOffset = (i - 1) * 2;
    const postingExecutiveId = pickAssignedUserId(carouselTeam, "postingExecutive");

    let cursor = addDaysUTC(baseStartDate, postMaxOffset + staggerOffset);
    let postingDue = await scheduleStageDay(
      "postingExecutive",
      postingExecutiveId,
      cursor,
      holidaySet
    );

    let postingKey = ymdUTC(postingDue);
    while (postingKey && usedCarouselPostingDayKeys.has(postingKey)) {
      postingDue = await scheduleStageDay(
        "postingExecutive",
        postingExecutiveId,
        addDaysUTC(postingDue, 1),
        holidaySet
      );
      postingKey = ymdUTC(postingDue);
    }
    if (postingKey) usedCarouselPostingDayKeys.add(postingKey);

    const { postingDate, stages } = generateWorkflowStagesFromPostingDate(
      postingDue,
      "carousel"
    );
    keepLatestPosting(postingDue);

    const stagesFinal = stages.map((s) => ({
      name: s.stageName,
      role: s.role,
      assignedUser: pickAssignedUserId(carouselTeam, s.role),
      date: s.date,
      status: "assigned",
    }));

    items.push({
      contentId: `Carousel #${i}`,
      title: `Carousel #${i}`,
      type: "carousel",
      plan: "normal",
      planType: "normal",
      postingDate,
      stages: stagesFinal,
    });
  }

  const endDate = lastPostingDate ? ymdUTC(lastPostingDate) : null;

  return {
    items,
    endDate,
    activeContentCounts,
  };
}

module.exports = {
  generateCalendarDraft,
};

