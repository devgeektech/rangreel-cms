const PublicHoliday = require("../models/PublicHoliday");
const Leave = require("../models/Leave");
const { BACKWARD_OFFSETS } = require("./workflowFromPostingDate.service");
const { buildSortedWorkUnitsDraft } = require("./schedulerPriority.service");
const {
  buildReelItemForCalendarDraft,
  buildPostItemForCalendarDraft,
  buildCarouselItemForCalendarDraft,
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
  let schedulingOpts = {
    allowWeekend: allowWeekend === true,
    allowFlexibleAdjustment: allowFlexibleAdjustment === true,
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
  const usedReelPostingDayKeys = new Set();
  const usedPostPostingDayKeys = new Set();
  const usedCarouselPostingDayKeys = new Set();

  const keepLatestPosting = (d) => {
    const cur = createUTCDate(d);
    if (!cur) return;
    if (!lastPostingDate || cur.getTime() > lastPostingDate.getTime()) lastPostingDate = cur;
  };

  const items = [];

  /** PROMPT 68 — same priority as `generateClientReels` (urgent → earliest posting cursor → normal). */
  const draftWorkUnits = buildSortedWorkUnitsDraft(
    baseStartDate,
    reelsCount,
    postsCount,
    carouselsCount,
    reelsMaxOffset,
    postMaxOffset,
    addDaysUTC
  );

  for (const unit of draftWorkUnits) {
    if (unit.kind === "reel") {
      const i = unit.index;
      const isUrgent = i <= 2;
      const reelItem = await buildReelItemForCalendarDraft({
        i,
        isUrgent,
        baseStartDate,
        holidaySet,
        schedulingOpts,
        reelTeam,
        usedReelPostingDayKeys,
      });
      keepLatestPosting(createUTCDate(reelItem.postingDate));
      items.push(reelItem);
    } else if (unit.kind === "post") {
      const i = unit.index;
      const postItem = await buildPostItemForCalendarDraft({
        i,
        baseStartDate,
        holidaySet,
        schedulingOpts,
        postTeam,
        usedPostPostingDayKeys,
      });
      keepLatestPosting(createUTCDate(postItem.postingDate));
      items.push(postItem);
    } else {
      const i = unit.index;
      const carouselItem = await buildCarouselItemForCalendarDraft({
        i,
        baseStartDate,
        holidaySet,
        schedulingOpts,
        carouselTeam,
        usedCarouselPostingDayKeys,
      });
      keepLatestPosting(createUTCDate(carouselItem.postingDate));
      items.push(carouselItem);
    }
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

