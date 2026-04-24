const PublicHoliday = require("../models/PublicHoliday");
const Leave = require("../models/Leave");
const { BACKWARD_OFFSETS } = require("./workflowFromPostingDate.service");
const { buildSortedWorkUnitsDraft } = require("./schedulerPriority.service");
const {
  buildReelItemForCalendarDraft,
  buildPostItemForCalendarDraft,
  buildCarouselItemForCalendarDraft,
  buildStrategistStartDates,
} = require("./simpleCalendar.service");

// Prompt 34: force date storage as pure UTC midnight.
// Parse YYYY-MM-DD as UTC calendar date — do not use getDate()/getMonth() (local) on ISO date strings
// or "April 3" selected in the UI becomes April 2 UTC in US timezones.
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

const ymdUTC = (date) => {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
};

function getMonthKey(date) {
  if (!date) return "";
  return new Date(date).toISOString().slice(0, 7); // YYYY-MM
}

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

function maxDaysBeforePost(offsets) {
  if (!Array.isArray(offsets)) return 0;
  return offsets.reduce((m, row) => Math.max(m, Number(row.daysBeforePost) || 0), 0);
}

/**
 * Generate a draft calendar purely in-memory (no DB writes).
 * Uses the same forward scheduling pipeline as `generateClientReels` (strategist anchor → sequential stages;
 * reels 1–2 urgent, then normal) so preview matches persisted calendars.
 */
async function generateCalendarDraft({
  packageCounts,
  startDate,
  team,
  contentEnabled = {},
  allowWeekend = false,
  allowFlexibleAdjustment = false,
}) {
  const previousSuppress = globalThis.__RR_SUPPRESS_SCHEDULER_WARNINGS__;
  globalThis.__RR_SUPPRESS_SCHEDULER_WARNINGS__ = true;
  try {
  // Keep draft generation focused on the immediate 30-day planning window.
  const PREVIEW_CYCLE_COUNT = 1;
  let schedulingOpts = {
    allowWeekend: allowWeekend === true,
    allowFlexibleAdjustment: allowFlexibleAdjustment === true,
    allowPostingDayStacking: true,
    leaves: [],
  };
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

  const total = (reelsCount + postsCount + carouselsCount) * PREVIEW_CYCLE_COUNT;
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

  const estimateEnd = addDaysUTC(baseStartDate, total * 40 + 180);
  const holidaySet = await buildHolidaySetUTC(baseStartDate, estimateEnd);

  const leaveDocs = await Leave.find({
    startDate: { $lte: estimateEnd },
    endDate: { $gte: baseStartDate },
  }).lean();
  schedulingOpts.leaves = (leaveDocs || []).map((doc) => ({
    userId: doc.userId,
    from: doc.startDate,
    to: doc.endDate,
  }));

  const reelTeam = getTeamForContentType(team, "reel");
  const postTeam = getTeamForContentType(team, "post");
  const carouselTeam = getTeamForContentType(team, "carousel");

  let lastPostingDate = null;
  const keepLatestPosting = (d) => {
    const cur = createUTCDate(d);
    if (!cur) return;
    if (!lastPostingDate || cur.getTime() > lastPostingDate.getTime()) lastPostingDate = cur;
  };

  const items = [];
  const cycleRanges = [];

  const buildCycleAttempt = async ({
    cycleStart,
    cycleIndex,
    localSchedulingOpts,
    reelOffset,
    postOffset,
    carouselOffset,
  }) => {
    const cycleBaseStartDate = addDaysUTC(cycleStart, 1);
    const draftWorkUnits = buildSortedWorkUnitsDraft(
      cycleBaseStartDate,
      reelsCount,
      postsCount,
      carouselsCount,
      reelsMaxOffset,
      postMaxOffset,
      addDaysUTC,
      startDate // Prompt 209
    );
    const strategistStarts = buildStrategistStartDates({
      baseStartDate: cycleBaseStartDate,
      reelsCount,
      postsCount,
      carouselsCount,
      holidaySet,
      monthOffsets: [0],
    });
    const usedReelPostingDayKeysCycle = new Set();
    const usedPostPostingDayKeysCycle = new Set();
    const usedCarouselPostingDayKeysCycle = new Set();

    const cycleItems = [];
    let maxPosting = null;
    let reelCursor = reelOffset;
    let postCursor = postOffset;
    let carouselCursor = carouselOffset;
    for (const unit of draftWorkUnits) {
      if (unit.kind === "reel") {
        reelCursor += 1;
        const i = unit.index;
        const reelMonth = getMonthKey(cycleBaseStartDate);
        const firstMonth = getMonthKey(startDate);
        const isUrgent = reelMonth === firstMonth && i <= 2;
        const reelItem = await buildReelItemForCalendarDraft({
          i,
          isUrgent,
          baseStartDate: cycleBaseStartDate,
          strategistStartDate: strategistStarts.reel[i - 1],
          holidaySet,
          schedulingOpts: localSchedulingOpts,
          reelTeam,
          usedReelPostingDayKeys: usedReelPostingDayKeysCycle,
        });
        reelItem.contentId = `Reel #${reelCursor}`;
        reelItem.title = `Reel #${reelCursor}`;
        reelItem.cycleIndex = cycleIndex;
        const post = createUTCDate(reelItem.postingDate);
        if (post && (!maxPosting || post.getTime() > maxPosting.getTime())) maxPosting = post;
        cycleItems.push(reelItem);
      } else if (unit.kind === "post") {
        postCursor += 1;
        const i = unit.index;
        const postItem = await buildPostItemForCalendarDraft({
          i,
          baseStartDate: cycleBaseStartDate,
          strategistStartDate: strategistStarts.post[i - 1],
          holidaySet,
          schedulingOpts: localSchedulingOpts,
          postTeam,
          usedPostPostingDayKeys: usedPostPostingDayKeysCycle,
        });
        postItem.contentId = `Post #${postCursor}`;
        postItem.title = `Post #${postCursor}`;
        postItem.cycleIndex = cycleIndex;
        const post = createUTCDate(postItem.postingDate);
        if (post && (!maxPosting || post.getTime() > maxPosting.getTime())) maxPosting = post;
        cycleItems.push(postItem);
      } else {
        carouselCursor += 1;
        const i = unit.index;
        const carouselItem = await buildCarouselItemForCalendarDraft({
          i,
          baseStartDate: cycleBaseStartDate,
          strategistStartDate: strategistStarts.carousel[i - 1],
          holidaySet,
          schedulingOpts: localSchedulingOpts,
          carouselTeam,
          usedCarouselPostingDayKeys: usedCarouselPostingDayKeysCycle,
        });
        carouselItem.contentId = `Carousel #${carouselCursor}`;
        carouselItem.title = `Carousel #${carouselCursor}`;
        carouselItem.cycleIndex = cycleIndex;
        const post = createUTCDate(carouselItem.postingDate);
        if (post && (!maxPosting || post.getTime() > maxPosting.getTime())) maxPosting = post;
        cycleItems.push(carouselItem);
      }
    }

    return {
      cycleItems,
      maxPostingDate: maxPosting,
      reelCursor,
      postCursor,
      carouselCursor,
    };
  };

  /** PROMPT 68 — same priority as `generateClientReels` (urgent → earliest posting cursor → normal). */
  let cycleStart = createUTCDate(baseStart);
  let reelGlobalIndex = 0;
  let postGlobalIndex = 0;
  let carouselGlobalIndex = 0;
  for (let cycle = 0; cycle < PREVIEW_CYCLE_COUNT; cycle += 1) {
    const nominalCycleEnd = addDaysUTC(cycleStart, 29);
    const weekendAllowed = allowWeekend === true;
    const attemptConfigs = [
      { allowWeekend: weekendAllowed, allowFlexibleAdjustment: allowFlexibleAdjustment === true },
      // Keep weekend policy fixed to the manager toggle for initial generation.
      // If weekend is OFF, retries must still avoid Sat/Sun.
      { allowWeekend: weekendAllowed, allowFlexibleAdjustment: true },
    ];
    let picked = null;
    for (const cfg of attemptConfigs) {
      const attempt = await buildCycleAttempt({
        cycleStart,
        cycleIndex: cycle,
        localSchedulingOpts: {
          ...schedulingOpts,
          ...cfg,
          suppressSchedulerWarnings: true,
        },
        reelOffset: reelGlobalIndex,
        postOffset: postGlobalIndex,
        carouselOffset: carouselGlobalIndex,
      });
      picked = attempt;
      const maxDate = attempt.maxPostingDate;
      if (maxDate && maxDate.getTime() <= nominalCycleEnd.getTime()) break;
    }

    const cycleItems = picked?.cycleItems || [];
    for (const it of cycleItems) {
      keepLatestPosting(createUTCDate(it.postingDate));
      items.push(it);
    }
    reelGlobalIndex = picked?.reelCursor ?? reelGlobalIndex;
    postGlobalIndex = picked?.postCursor ?? postGlobalIndex;
    carouselGlobalIndex = picked?.carouselCursor ?? carouselGlobalIndex;

    const completedEnd = picked?.maxPostingDate || nominalCycleEnd;
    cycleRanges.push({
      monthIndex: cycle,
      start: createUTCDate(cycleStart),
      end: createUTCDate(completedEnd),
      nominalEnd: createUTCDate(nominalCycleEnd),
      overflowed: completedEnd.getTime() > nominalCycleEnd.getTime(),
    });

    if (completedEnd.getTime() <= nominalCycleEnd.getTime()) {
      cycleStart = addDaysUTC(cycleStart, 30);
    } else {
      cycleStart = addDaysUTC(completedEnd, 1);
    }
  }

  const endDate = lastPostingDate ? ymdUTC(lastPostingDate) : null;

  return {
    items,
    endDate,
    activeContentCounts,
    cycleRanges,
  };
  } finally {
    globalThis.__RR_SUPPRESS_SCHEDULER_WARNINGS__ = previousSuppress === true;
  }
}

module.exports = {
  generateCalendarDraft,
};

