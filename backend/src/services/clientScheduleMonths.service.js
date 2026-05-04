const ContentItem = require("../models/ContentItem");
const Schedule = require("../models/Schedule");
const Client = require("../models/Client");
const { getCustomMonthRange, normalizeUtcMidnight } = require("./customMonthRange.service");
const { validateStagesNotAfterPosting } = require("./stageBoundary.service");

/** Canonical order for “pipeline complete before Post” — only explicit dueDates counted (no posting fallback). */
const PIPELINE_BEFORE_POST_BY_TYPE = {
  reel: ["Plan", "Shoot", "Edit", "Approval"],
  post: ["Plan", "Design", "Approval"],
  carousel: ["Plan", "Design", "Approval"],
};

/** Calendar days before each contract-cycle start where scheduling/grid begins (equal spread window). */
const SCHEDULE_DISTRIBUTION_LEAD_DAYS = 0;

function resolveDistributionLeadDays(client, options = {}) {
  const fromOpts = Number(options?.distributionLeadDays);
  if (Number.isFinite(fromOpts) && fromOpts >= 0) return Math.floor(fromOpts);
  const fromRules = Number(client?.rules?.distributionLeadDays);
  if (Number.isFinite(fromRules) && fromRules >= 0) return Math.floor(fromRules);
  return SCHEDULE_DISTRIBUTION_LEAD_DAYS;
}

/** Persisted Schedule.startDate: cycle contract start minus lead so early placements stay visible. */
function scheduleDisplayStartUtc(contractCycleStart, leadDays) {
  const s = normalizeUtcMidnight(contractCycleStart);
  if (!s) return null;
  const lead = Math.max(0, Number(leadDays) || 0);
  return addDaysUTC(s, -lead);
}

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
  const list = Array.isArray(days) ? days.filter(Boolean) : [];
  const weeks = [];
  for (let i = 0; i < list.length; i += 7) {
    weeks.push(list.slice(i, i + 7));
  }
  return weeks;
}

/** Split sorted eligible posting days into four buckets (~¼ each) for balanced monthly spread. */
function splitEligibleDaysIntoFourBuckets(eligibleDays) {
  const list = [...(eligibleDays || [])].filter(Boolean).sort((a, b) => a.getTime() - b.getTime());
  const buckets = [[], [], [], []];
  if (!list.length) return buckets;
  const targets = getWeeklyTargets(list.length, 4);
  let idx = 0;
  for (let w = 0; w < 4; w += 1) {
    const take = targets[w];
    buckets[w] = list.slice(idx, idx + take);
    idx += take;
  }
  return buckets;
}

function utcCalendarDaysDiff(fromUtcMidnight, toUtcMidnight) {
  const a = normalizeUtcMidnight(fromUtcMidnight);
  const b = normalizeUtcMidnight(toUtcMidnight);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** Week 0 = cycle days 0–6 from contract start (lead days before contract → week 0). Then weeks 1–3 in 7-day steps. */
function cycleWeekIndexFromContractStart(cycleContractStart, day) {
  const anchor = normalizeUtcMidnight(cycleContractStart);
  const d = normalizeUtcMidnight(day);
  if (!anchor || !d) return 0;
  let w = Math.floor(utcCalendarDaysDiff(anchor, d) / 7);
  if (w < 0) w = 0;
  if (w > 3) w = 3;
  return w;
}

function splitPlacementDaysIntoFourCycleWeeks(cycleContractStart, placementDays) {
  const buckets = [[], [], [], []];
  const list = [...(placementDays || [])].filter(Boolean).sort((a, b) => a.getTime() - b.getTime());
  for (const d of list) {
    buckets[cycleWeekIndexFromContractStart(cycleContractStart, d)].push(d);
  }
  return buckets;
}

/** Posting slots only: first two reels → contract cycle week 1 (UTC days 0–6 from cycle start); remaining reels + posts + carousels ~⅓ each across weeks 2–4 (indices 1–3). Pipeline/clamps unchanged downstream. */
function placePostingSlotsDefaultFourWeekPlan({
  cycleContractStart,
  placementDays,
  dayMap,
  reelsPool,
  postsPool,
  carouselPool,
}) {
  const cycleStart = normalizeUtcMidnight(cycleContractStart);
  const sortedPlacement = [...placementDays].filter(Boolean).sort((a, b) => a.getTime() - b.getTime());
  if (!sortedPlacement.length || !cycleStart) return;

  const weekBuckets = splitPlacementDaysIntoFourCycleWeeks(cycleStart, sortedPlacement);

  let week1Days = weekBuckets[0];
  if (!week1Days.length) {
    week1Days = sortedPlacement.slice(0, Math.min(7, sortedPlacement.length));
  }

  const reels = [...reelsPool];
  const week1Reels = reels.splice(0, Math.min(2, reels.length));

  placeTypeRoundRobinMiddleFirst("reel", week1Reels, week1Days, dayMap);

  const tailQueue = shuffleContent(reels, postsPool, carouselPool);
  const spillTailDays = sortedPlacement.filter((d) => cycleWeekIndexFromContractStart(cycleStart, d) >= 1);
  const tailFallbackDays = spillTailDays.length ? spillTailDays : sortedPlacement;

  const targets = getWeeklyTargets(tailQueue.length, 3);
  for (let wi = 0; wi < 3; wi += 1) {
    let n = targets[wi];
    const bucketDays = weekBuckets[wi + 1];
    const poolDays = bucketDays.length ? bucketDays : tailFallbackDays;
    while (n > 0 && tailQueue.length > 0) {
      const day = pickLeastLoadedDay(poolDays, dayMap);
      if (!day) break;
      const entry = tailQueue.shift();
      dayMap[ymdUTC(day)].items.push(entry);
      n -= 1;
    }
  }

  while (tailQueue.length > 0) {
    const day = pickLeastLoadedDay(tailFallbackDays, dayMap);
    if (!day) break;
    dayMap[ymdUTC(day)].items.push(tailQueue.shift());
  }
}

function getWeeklyTargets(total, weeks = 4) {
  const base = Math.floor(total / weeks);
  let remainder = total % weeks;
  const result = [];
  for (let i = 0; i < weeks; i += 1) {
    result.push(base + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder -= 1;
  }
  return result;
}

function orderDaysMiddleFirst(days) {
  const list = Array.isArray(days) ? days.filter(Boolean) : [];
  const mid = Math.floor(list.length / 2);
  const ordered = [];
  for (let i = 0; i < list.length; i += 1) {
    if (mid - i >= 0) ordered.push(list[mid - i]);
    if (mid + i < list.length && i !== 0) ordered.push(list[mid + i]);
  }
  return ordered;
}

function pickLeastLoadedDay(days, dayMap) {
  const candidates = orderDaysMiddleFirst(days);
  if (!candidates.length) return null;
  let bestDay = candidates[0];
  let bestLoad = Number.POSITIVE_INFINITY;
  for (const d of candidates) {
    const key = ymdUTC(d);
    const load = Array.isArray(dayMap[key]?.items) ? dayMap[key].items.length : 0;
    if (load < bestLoad) {
      bestDay = d;
      bestLoad = load;
    }
  }
  return bestDay;
}

function placeTypeAcrossWeeks(type, pool, weeks, targets, dayMap, allDays) {
  const localPool = Array.isArray(pool) ? pool : [];
  for (let w = 0; w < weeks.length; w += 1) {
    const count = Math.min(Number(targets[w]) || 0, localPool.length);
    for (let i = 0; i < count; i += 1) {
      const day = pickLeastLoadedDay(weeks[w], dayMap);
      if (!day) break;
      const key = ymdUTC(day);
      dayMap[key].items.push({ type, item: localPool.shift() });
    }
  }

  // Overflow (if any): keep spreading to least-loaded day in full cycle.
  while (localPool.length > 0) {
    const day = pickLeastLoadedDay(allDays, dayMap);
    if (!day) break;
    const key = ymdUTC(day);
    dayMap[key].items.push({ type, item: localPool.shift() });
  }
}

/** Spread items evenly across eligible days (middle-first rotation). */
function placeTypeRoundRobinMiddleFirst(type, poolTemplate, placementDays, dayMap) {
  const pool = [...poolTemplate];
  const sorted = [...placementDays].filter(Boolean).sort((a, b) => a.getTime() - b.getTime());
  const ordered = orderDaysMiddleFirst(sorted);
  if (!ordered.length || !pool.length) return;
  for (let i = 0; i < pool.length; i += 1) {
    const day = ordered[i % ordered.length];
    const key = ymdUTC(day);
    if (!dayMap[key]) continue;
    dayMap[key].items.push({ type, item: pool.shift() });
  }
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
  const mid = Math.floor(list.length / 2);
  const preferredOrder = [];
  for (let i = 0; i < list.length; i += 1) {
    if (mid - i >= 0) preferredOrder.push(list[mid - i]);
    if (mid + i < list.length && i !== 0) preferredOrder.push(list[mid + i]);
  }
  let placed = 0;
  for (let i = 0; i < want && pool.length > 0; i += 1) {
    let bestDay = preferredOrder[0];
    let bestLoad = Number.POSITIVE_INFINITY;
    for (const day of preferredOrder) {
      const key = ymdUTC(day);
      const load = Array.isArray(dayMap[key]?.items) ? dayMap[key].items.length : 0;
      if (load < bestLoad) {
        bestDay = day;
        bestLoad = load;
      }
    }
    const key = ymdUTC(bestDay);
    dayMap[key].items.push({ type, item: pool.shift() });
    placed += 1;
  }
  return placed;
}

/** Latest explicit dueDate among every non-Post stage across reels, posts, and carousels. */
function globalLatestNonPostDueUtc(contentRows) {
  let maxD = null;
  for (const row of contentRows || []) {
    const wf = Array.isArray(row?.workflowStages) ? row.workflowStages : [];
    for (const s of wf) {
      if (String(s?.stageName || "") === "Post") continue;
      const d = normalizeUtcMidnight(s?.dueDate);
      if (!d) continue;
      if (!maxD || d.getTime() > maxD.getTime()) maxD = d;
    }
  }
  return maxD;
}

/** First calendar day when posting may run for this client: strictly after global upstream completion. */
function globalFirstPostingSlotUtc(contentRows) {
  const latest = globalLatestNonPostDueUtc(contentRows);
  if (!latest) return null;
  return addDaysUTC(latest, 1);
}

/**
 * SINGLE SOURCE OF TRUTH for monthly schedule generation.
 * Enumerates from enumerationStartDate (typically contract cycle start minus lead days) through cycle end,
 * places postings only on or after max(upstream-completion floor, enumeration start).
 * Default: first two reels’ posting slots in cycle week 1; remaining reels + posts + carousels balanced ~⅓ per week across weeks 2–4 (~¼ posting exec load overall).
 * rules.uniformPostingSpread === false → legacy quarter-chunk buckets per content type.
 */
function generateMonthlySchedule({
  cycleContractStart,
  enumerationStartDate,
  endDate,
  reelsCount,
  postsCount,
  carouselCount,
  rules = {},
}) {
  const cycleStart = normalizeUtcMidnight(cycleContractStart);
  const enumStartNorm = normalizeUtcMidnight(enumerationStartDate);
  const enumStart = enumStartNorm || cycleStart;
  const end = normalizeUtcMidnight(endDate);
  if (!cycleStart || !end || cycleStart > end) return [];

  const weekendOff = rules.weekendOff !== false;
  const maxPerDay = Math.max(0, Number(rules.maxPerDay) || 0);
  const strictCycleEnd = addDaysUTC(cycleStart, 29);
  const boundedEnd = strictCycleEnd && strictCycleEnd < end ? strictCycleEnd : end;
  const allDays = enumerateDays(enumStart, boundedEnd);
  const validDays = weekendOff
    ? allDays.filter((d) => {
        const dow = d.getUTCDay();
        return dow !== 0 && dow !== 6;
      })
    : allDays;
  const days = validDays.length ? validDays : allDays;
  if (!days.length) return [];

  const placementUpstreamFloor = normalizeUtcMidnight(rules.postingPlacementEarliestDate);
  const placementMin = placementUpstreamFloor
    ? maxUtcMidnight(placementUpstreamFloor, enumStart)
    : enumStart;

  let placementDays = days.filter((d) => {
    const x = normalizeUtcMidnight(d);
    return x && placementMin && x.getTime() >= placementMin.getTime();
  });
  if (!placementDays.length) {
    placementDays = [...days];
  }

  const dayMap = {};
  for (const d of placementDays) {
    const k = ymdUTC(d);
    dayMap[k] = { date: d, items: [] };
  }

  const reelsPool = Array.from({ length: Math.max(0, Number(reelsCount) || 0) }, (_, i) => ({ idx: i + 1 }));
  const postsPool = Array.from({ length: Math.max(0, Number(postsCount) || 0) }, (_, i) => ({ idx: i + 1 }));
  const carouselPool = Array.from({ length: Math.max(0, Number(carouselCount) || 0) }, (_, i) => ({ idx: i + 1 }));

  const useQuarterBuckets = rules.uniformPostingSpread === false;
  if (useQuarterBuckets) {
    const buckets = splitEligibleDaysIntoFourBuckets(placementDays);
    const reelTargets = getWeeklyTargets(reelsPool.length, buckets.length);
    const postTargets = getWeeklyTargets(postsPool.length, buckets.length);
    const carouselTargets = getWeeklyTargets(carouselPool.length, buckets.length);
    placeTypeAcrossWeeks("reel", reelsPool, buckets, reelTargets, dayMap, placementDays);
    placeTypeAcrossWeeks("post", postsPool, buckets, postTargets, dayMap, placementDays);
    placeTypeAcrossWeeks("carousel", carouselPool, buckets, carouselTargets, dayMap, placementDays);
  } else {
    placePostingSlotsDefaultFourWeekPlan({
      cycleContractStart: cycleStart,
      placementDays,
      dayMap,
      reelsPool,
      postsPool,
      carouselPool,
    });
  }

  // Respect max-per-day as a final guard by trimming overflow entries from overloaded days.
  if (maxPerDay > 0) {
    const spill = [];
    for (const d of placementDays) {
      const key = ymdUTC(d);
      while (dayMap[key]?.items?.length > maxPerDay) {
        spill.push(dayMap[key].items.pop());
      }
    }
    while (spill.length > 0) {
      const entry = spill.shift();
      const day = placementDays.find((d) => {
        const key = ymdUTC(d);
        return dayMap[key].items.length < maxPerDay;
      });
      if (!day) break;
      dayMap[ymdUTC(day)].items.push(entry);
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

function pipelineBeforePostOrder(contentType) {
  const t = String(contentType || "reel").toLowerCase();
  return PIPELINE_BEFORE_POST_BY_TYPE[t] || PIPELINE_BEFORE_POST_BY_TYPE.reel;
}

/** Latest explicit due date among pre-Post stages (matches reel/post/carousel pipelines). */
function maxExplicitPipelineDue(workflowStages, contentType) {
  const wf = Array.isArray(workflowStages) ? workflowStages : [];
  const order = pipelineBeforePostOrder(contentType);
  const byName = new Map(wf.map((s) => [String(s?.stageName || "").trim(), s]));
  let chainMax = null;
  for (const name of order) {
    const d = normalizeUtcMidnight(byName.get(name)?.dueDate);
    if (!d) continue;
    if (!chainMax || d.getTime() > chainMax.getTime()) chainMax = d;
  }
  if (!chainMax) {
    for (const s of wf) {
      if (String(s?.stageName || "") === "Post") continue;
      const d = normalizeUtcMidnight(s?.dueDate);
      if (!d) continue;
      if (!chainMax || d.getTime() > chainMax.getTime()) chainMax = d;
    }
  }
  return chainMax;
}

/**
 * First calendar day allowed for publishing: strictly after all upstream stages complete
 * (aligns with locked-post rules where Approval must be before posting day).
 */
function earliestCalendarPostingAfterPipeline(workflowStages, contentType, fallbackPosting) {
  const chainMax = maxExplicitPipelineDue(workflowStages, contentType);
  if (chainMax) return addDaysUTC(chainMax, 1);
  return normalizeUtcMidnight(fallbackPosting);
}

/** Latest of two UTC midnights (implements max of two “earliest posting” floors). */
function maxUtcMidnight(a, b) {
  const x = normalizeUtcMidnight(a);
  const y = normalizeUtcMidnight(b);
  if (!x) return y;
  if (!y) return x;
  return x.getTime() >= y.getTime() ? x : y;
}

/** validateStagesNotAfterPosting violations use YYYY-MM-DD — parse as UTC calendar day. */
function parseViolationYmdUtc(stageDateYmd) {
  const m = String(stageDateYmd || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return normalizeUtcMidnight(stageDateYmd);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Calendar day strictly after latest non-Post date already placed on schedule snapshot. */
function earliestPostingFromScheduleStagesSnapshot(stages) {
  let maxD = null;
  for (const s of stages || []) {
    if (String(s?.name || "") === "Post") continue;
    const d = normalizeUtcMidnight(s?.date);
    if (!d) continue;
    if (!maxD || d.getTime() > maxD.getTime()) maxD = d;
  }
  return maxD ? addDaysUTC(maxD, 1) : null;
}

/**
 * Hard floor: postingDate ≥ max(global upstream completion, item pipeline +1, snapshot upstream +1).
 * Only moves Post — upstream snapshot dates stay from ContentItem.
 */
function clampPostingAfterUpstreamFloors(globalPostingFloor, row, contentTypeKey, srcPost, postingDate, stages) {
  const pipelineMin = earliestCalendarPostingAfterPipeline(row?.workflowStages, contentTypeKey, srcPost);
  const snapshotMin = earliestPostingFromScheduleStagesSnapshot(stages);
  let post = normalizeUtcMidnight(postingDate);
  post = maxUtcMidnight(post, globalPostingFloor);
  post = maxUtcMidnight(post, pipelineMin);
  post = maxUtcMidnight(post, snapshotMin);
  const ps = stages.find((x) => String(x?.name || "") === "Post");
  if (ps) ps.date = post;
  return post;
}

function bumpPostingUntilScheduleValid(stagesOutput, postingDateInput) {
  let post = normalizeUtcMidnight(postingDateInput);
  if (!post || !Array.isArray(stagesOutput)) return post;
  for (let iter = 0; iter < 400; iter += 1) {
    const draftStages = stagesOutput.map((s) => {
      const name = String(s?.name || "");
      const date = name === "Post" ? post : normalizeUtcMidnight(s.date);
      return { name, stageName: name, date, dueDate: date };
    });
    const res = validateStagesNotAfterPosting(draftStages, post);
    if (res.ok) return post;
    let latestViolation = null;
    for (const v of res.violations || []) {
      const d = parseViolationYmdUtc(v.stageDate);
      if (!d) continue;
      if (!latestViolation || d.getTime() > latestViolation.getTime()) latestViolation = d;
    }
    if (!latestViolation) return post;
    post = addDaysUTC(latestViolation, 1);
  }
  return post;
}

/**
 * Distribution may place posting in an early bucket; pipeline stages stay fixed from generation.
 * If distributed post day is before the earliest allowed posting day (suffix window + day-after-final upstream),
 * pick the least-loaded valid day in later cycle weeks (same split as placement), otherwise any remaining eligible month day.
 */
function resolveDistributedPostingDate(
  distributedDate,
  earliestPostAllowed,
  cycleContractStart,
  monthlyRows,
  postingLoadByDay
) {
  const dist = normalizeUtcMidnight(distributedDate);
  const minP = normalizeUtcMidnight(earliestPostAllowed);
  if (!dist) return minP;
  if (!minP || dist.getTime() >= minP.getTime()) return dist;

  const monthValidDays = monthlyRows.map((r) => normalizeUtcMidnight(r.date)).filter(Boolean);
  if (!monthValidDays.length) return minP;

  const anchor = normalizeUtcMidnight(cycleContractStart);
  const buckets = anchor
    ? splitPlacementDaysIntoFourCycleWeeks(anchor, monthValidDays)
    : splitEligibleDaysIntoFourBuckets(monthValidDays);
  let bucketOfDist = -1;
  for (let b = 0; b < buckets.length; b += 1) {
    if (buckets[b].some((d) => ymdUTC(d) === ymdUTC(dist))) {
      bucketOfDist = b;
      break;
    }
  }

  const laterDays = [];
  if (bucketOfDist >= 0) {
    for (let b = bucketOfDist + 1; b < buckets.length; b += 1) {
      laterDays.push(...buckets[b]);
    }
  }

  let candidates = laterDays.filter((d) => d.getTime() >= minP.getTime());
  if (!candidates.length) {
    candidates = monthValidDays.filter((d) => d.getTime() >= minP.getTime());
  }
  if (!candidates.length) return minP;

  const loadMap = {};
  for (const d of candidates) {
    const k = ymdUTC(d);
    const n = postingLoadByDay.get(k) || 0;
    loadMap[k] = { date: d, items: Array(n).fill(0) };
  }
  const picked = pickLeastLoadedDay(candidates, loadMap);
  return picked || candidates.sort((a, b) => a.getTime() - b.getTime())[0];
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

/** Same eligible posting-day window as generateMonthlySchedule (enumeration → bounded end, placement floor). */
function enumerateValidPlacementDaysForCycle({
  cycleContractStart,
  enumerationStartDate,
  endDate,
  weekendOff,
  postingPlacementEarliestDate,
}) {
  const cycleStart = normalizeUtcMidnight(cycleContractStart);
  const enumStartNorm = normalizeUtcMidnight(enumerationStartDate);
  const enumStart = enumStartNorm || cycleStart;
  const end = normalizeUtcMidnight(endDate);
  if (!cycleStart || !end || cycleStart > end) return [];

  const strictCycleEnd = addDaysUTC(cycleStart, 29);
  const boundedEnd = strictCycleEnd && strictCycleEnd < end ? strictCycleEnd : end;
  const allDays = enumerateDays(enumStart, boundedEnd);
  const validDays = weekendOff
    ? allDays.filter((d) => {
        const dow = d.getUTCDay();
        return dow !== 0 && dow !== 6;
      })
    : allDays;
  const days = validDays.length ? validDays : allDays;
  if (!days.length) return [];

  const placementUpstreamFloor = normalizeUtcMidnight(postingPlacementEarliestDate);
  const placementMin = placementUpstreamFloor
    ? maxUtcMidnight(placementUpstreamFloor, enumStart)
    : enumStart;

  let placementDays = days.filter((d) => {
    const x = normalizeUtcMidnight(d);
    return x && placementMin && x.getTime() >= placementMin.getTime();
  });
  if (!placementDays.length) {
    placementDays = [...days];
  }
  return placementDays;
}

function sortItemsForPlacement(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const reels = list.filter((r) => r.type === "reel");
  const posts = list.filter((r) => r.type === "post");
  const carousels = list.filter((r) => r.type === "carousel");
  return [...reels, ...posts, ...carousels];
}

function computeItemEarliestPostingUtc(row, contentTypeKey, globalFloor, enumStart) {
  const srcPost = normalizeUtcMidnight(row?.clientPostingDate || enumStart);
  const pipelineMin = earliestCalendarPostingAfterPipeline(
    row?.workflowStages,
    contentTypeKey,
    srcPost
  );
  return maxUtcMidnight(maxUtcMidnight(globalFloor, pipelineMin), enumStart);
}

function firstEligibleWeekIndexForPosting(weekBuckets, itemEarliest) {
  if (!itemEarliest) return 0;
  const t = itemEarliest.getTime();
  for (let w = 0; w < 4; w += 1) {
    if ((weekBuckets[w] || []).some((d) => normalizeUtcMidnight(d).getTime() >= t)) return w;
  }
  return 3;
}

function latestEligibleWeekIndexForPosting(weekBuckets, itemEarliest) {
  if (!itemEarliest) return 3;
  const t = itemEarliest.getTime();
  for (let w = 3; w >= 0; w -= 1) {
    if ((weekBuckets[w] || []).some((d) => normalizeUtcMidnight(d).getTime() >= t)) return w;
  }
  return 3;
}

function buildSyntheticDayMapForPick(days, postingLoadByDay) {
  const dayMap = {};
  for (const d of days) {
    const k = ymdUTC(d);
    const n = postingLoadByDay.get(k) || 0;
    dayMap[k] = { date: d, items: Array(n).fill(0) };
  }
  return dayMap;
}

function choosePostingWeekIndex({
  isFirstTwoReels,
  firstEligibleWeek,
  weekLoads,
  targets,
  weekBuckets,
  itemEarliest,
}) {
  const t = itemEarliest.getTime();
  const weekHasSlot = (w) =>
    (weekBuckets[w] || []).some((d) => normalizeUtcMidnight(d).getTime() >= t);
  const underCap = (w) => (weekLoads[w] || 0) < (targets[w] || 0);

  const tryWeeks = [];
  if (isFirstTwoReels && firstEligibleWeek === 0 && weekHasSlot(0)) {
    tryWeeks.push(0);
  }
  for (let w = firstEligibleWeek; w <= 3; w += 1) {
    if (!tryWeeks.includes(w)) tryWeeks.push(w);
  }

  for (const w of tryWeeks) {
    if (!weekHasSlot(w)) continue;
    if (underCap(w)) return w;
  }
  return latestEligibleWeekIndexForPosting(weekBuckets, itemEarliest);
}

function pickPostingDayForWeek({
  weekIndex,
  weekBuckets,
  validPlacementDays,
  itemEarliest,
  postingLoadByDay,
  maxPerDay,
}) {
  const t = itemEarliest.getTime();
  let candidates = (weekBuckets[weekIndex] || []).filter(
    (d) => normalizeUtcMidnight(d) && normalizeUtcMidnight(d).getTime() >= t
  );
  if (!candidates.length) {
    candidates = validPlacementDays.filter(
      (d) => normalizeUtcMidnight(d) && normalizeUtcMidnight(d).getTime() >= t
    );
  }
  if (!candidates.length) return null;

  const maxPD = Math.max(0, Number(maxPerDay) || 0);
  if (maxPD > 0) {
    const underCap = candidates.filter((d) => (postingLoadByDay.get(ymdUTC(d)) || 0) < maxPD);
    if (underCap.length) candidates = underCap;
  }

  return pickLeastLoadedDay(candidates, buildSyntheticDayMapForPick(candidates, postingLoadByDay));
}

function assertPostingStrictlyAfterManagerApproval(row, postingDate) {
  const wf = Array.isArray(row?.workflowStages) ? row.workflowStages : [];
  const appr = wf.find((s) => String(s?.stageName || "").trim() === "Approval");
  const apprDue = normalizeUtcMidnight(appr?.dueDate);
  const post = normalizeUtcMidnight(postingDate);
  if (!apprDue || !post) return;
  if (post.getTime() <= apprDue.getTime()) {
    const label = row?.title || String(row?._id || "content");
    throw new Error(
      `[schedule] Posting must be strictly after Approval for "${label}": posting=${ymdUTC(
        post
      )} approval=${ymdUTC(apprDue)}`
    );
  }
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

  const sourceRows = await ContentItem.find({ client: clientId, type: { $in: ["reel", "post", "carousel"] } })
    .select("_id title type clientPostingDate workflowStages")
    .sort({ createdAt: 1 })
    .lean();

  const globalPostingFloor = globalFirstPostingSlotUtc(sourceRows);
  const leadDays = resolveDistributionLeadDays(hydratedClient, options);
  const enumerationStart = addDaysUTC(start, -leadDays);

  const weekendOff =
    options?.forceWeekendOff === true ? true : hydratedClient?.weekendEnabled !== true;
  const maxPerDayRule = Math.max(0, Number(hydratedClient?.rules?.maxPerDay) || 0);

  const legacyGrid =
    options?.postingMode === "grid" || hydratedClient?.rules?.postingMode === "grid";

  if (legacyGrid) {
    const monthly = generateMonthlySchedule({
      cycleContractStart: start,
      enumerationStartDate: enumerationStart,
      endDate: end,
      reelsCount: totalReels,
      postsCount: totalPosts,
      carouselCount: totalCarousels,
      rules: {
        weekendOff,
        maxPerDay: maxPerDayRule,
        postingPlacementEarliestDate: globalPostingFloor,
        uniformPostingSpread: options?.uniformPostingSpread,
      },
    });
    const pools = {
      reel: sourceRows.filter((r) => r.type === "reel"),
      post: sourceRows.filter((r) => r.type === "post"),
      carousel: sourceRows.filter((r) => r.type === "carousel"),
    };
    const cursors = { reel: 0, post: 0, carousel: 0 };
    const postingLoadByDay = new Map();

    const items = [];
    for (const day of monthly) {
      for (const entry of day.items || []) {
        const pool = pools[entry.type] || [];
        if (!pool.length) continue;
        const idx = cursors[entry.type] % pool.length;
        cursors[entry.type] += 1;
        const row = pool[idx];
        const distributedPosting = normalizeUtcMidnight(day.date);
        const srcPost = normalizeUtcMidnight(row?.clientPostingDate || distributedPosting);
        const wf = Array.isArray(row?.workflowStages) ? row.workflowStages : [];
        const contentTypeKey = row?.type || entry.type || "reel";
        const pipelinePostingFloor = earliestCalendarPostingAfterPipeline(
          row.workflowStages,
          contentTypeKey,
          srcPost
        );
        const earliestPostAllowed = maxUtcMidnight(globalPostingFloor, pipelinePostingFloor);
        let postingDate = distributedPosting;
        if (
          earliestPostAllowed &&
          postingDate &&
          postingDate.getTime() < earliestPostAllowed.getTime()
        ) {
          postingDate = resolveDistributedPostingDate(
            distributedPosting,
            earliestPostAllowed,
            start,
            monthly,
            postingLoadByDay
          );
        }
        const stages = wf.map((s) => {
          const stageName = String(s?.stageName || "");
          let stageDate = normalizeUtcMidnight(s?.dueDate || srcPost);
          if (stageName === "Post") {
            stageDate = postingDate;
          }
          return {
            name: stageName,
            role: s?.role || "",
            assignedUser: s?.assignedUser || null,
            date: stageDate,
            status: s?.status || "assigned",
          };
        });
        postingDate = bumpPostingUntilScheduleValid(stages, postingDate);
        postingDate = clampPostingAfterUpstreamFloors(
          globalPostingFloor,
          row,
          contentTypeKey,
          srcPost,
          postingDate,
          stages
        );
        postingDate = bumpPostingUntilScheduleValid(stages, postingDate);
        const postRowOut = stages.find((x) => String(x?.name || "") === "Post");
        if (postRowOut) postRowOut.date = postingDate;
        assertPostingStrictlyAfterManagerApproval(row, postingDate);
        items.push({
          contentItem: row._id,
          title: row.title || "",
          type: row.type || entry.type,
          postingDate,
          stages,
        });
        if (postingDate) {
          const k = ymdUTC(postingDate);
          postingLoadByDay.set(k, (postingLoadByDay.get(k) || 0) + 1);
        }
      }
    }

    return items;
  }

  const validPlacementDays = enumerateValidPlacementDaysForCycle({
    cycleContractStart: start,
    enumerationStartDate: enumerationStart,
    endDate: end,
    weekendOff,
    postingPlacementEarliestDate: globalPostingFloor,
  });
  if (!validPlacementDays.length || !sourceRows.length) {
    return [];
  }

  const weekBuckets = splitPlacementDaysIntoFourCycleWeeks(start, validPlacementDays);
  const orderedRows = sortItemsForPlacement(sourceRows);
  const totalItems = orderedRows.length;
  const targets = getWeeklyTargets(totalItems, 4);
  const weekLoads = [0, 0, 0, 0];
  const postingLoadByDay = new Map();
  const items = [];

  let reelOrdinal = 0;
  for (const row of orderedRows) {
    const contentTypeKey = row?.type || "reel";
    const itemEarliest = computeItemEarliestPostingUtc(
      row,
      contentTypeKey,
      globalPostingFloor,
      enumerationStart
    );
    const firstEligibleWeek = firstEligibleWeekIndexForPosting(weekBuckets, itemEarliest);

    let isFirstTwoReels = false;
    if (row.type === "reel") {
      reelOrdinal += 1;
      isFirstTwoReels = reelOrdinal <= 2;
    }

    const targetWeek = choosePostingWeekIndex({
      isFirstTwoReels,
      firstEligibleWeek,
      weekLoads,
      targets,
      weekBuckets,
      itemEarliest,
    });

    let postingDate = pickPostingDayForWeek({
      weekIndex: targetWeek,
      weekBuckets,
      validPlacementDays,
      itemEarliest,
      postingLoadByDay,
      maxPerDay: maxPerDayRule,
    });

    if (!postingDate) {
      const fallbackDays = validPlacementDays.filter(
        (d) => normalizeUtcMidnight(d) && normalizeUtcMidnight(d).getTime() >= itemEarliest.getTime()
      );
      postingDate = pickLeastLoadedDay(
        fallbackDays,
        buildSyntheticDayMapForPick(fallbackDays, postingLoadByDay)
      );
    }
    if (!postingDate) {
      postingDate = itemEarliest;
    }

    weekLoads[targetWeek] += 1;

    const srcPost = normalizeUtcMidnight(row?.clientPostingDate || postingDate);
    const wf = Array.isArray(row?.workflowStages) ? row.workflowStages : [];

    const stages = wf.map((s) => {
      const stageName = String(s?.stageName || "");
      let stageDate = normalizeUtcMidnight(s?.dueDate || srcPost);
      if (stageName === "Post") {
        stageDate = postingDate;
      }
      return {
        name: stageName,
        role: s?.role || "",
        assignedUser: s?.assignedUser || null,
        date: stageDate,
        status: s?.status || "assigned",
      };
    });

    postingDate = bumpPostingUntilScheduleValid(stages, postingDate);
    postingDate = clampPostingAfterUpstreamFloors(
      globalPostingFloor,
      row,
      contentTypeKey,
      srcPost,
      postingDate,
      stages
    );
    postingDate = bumpPostingUntilScheduleValid(stages, postingDate);

    const postRowOut = stages.find((x) => String(x?.name || "") === "Post");
    if (postRowOut) postRowOut.date = postingDate;

    assertPostingStrictlyAfterManagerApproval(row, postingDate);

    items.push({
      contentItem: row._id,
      title: row.title || "",
      type: row.type,
      postingDate,
      stages,
    });

    if (postingDate) {
      const k = ymdUTC(postingDate);
      postingLoadByDay.set(k, (postingLoadByDay.get(k) || 0) + 1);
    }
  }

  return items;
}

/**
 * First 3 custom months after package / client creation. Idempotent if rows already exist.
 */
async function createInitialScheduleForClient(clientId) {
  const client = await Client.findById(clientId)
    .populate("package")
    .select("startDate isCustomCalendar activeContentCounts package totalReels totalPosts totalCarousels weekendEnabled rules")
    .lean();
  if (!client) {
    return { created: 0, skipped: true };
  }

  const existingRows = await Schedule.find({ clientId })
    .select("monthIndex")
    .lean();
  const existingIndexes = new Set(
    (existingRows || [])
      .map((r) => Number(r?.monthIndex))
      .filter((n) => Number.isFinite(n) && n >= 0)
  );
  const docs = [];
  const createdIndexes = [];
  let skippedExisting = 0;
  for (let i = 0; i < 3; i++) {
    if (existingIndexes.has(i)) {
      skippedExisting += 1;
      continue;
    }
    const range = getCustomMonthRange(client.startDate, i);
    const leadDays = resolveDistributionLeadDays(client, {});
    const items = await generateScheduleForRange(client, range, {
      forceWeekendOff: true,
      distributionLeadDays: leadDays,
    });
    docs.push({
      clientId,
      monthIndex: i,
      startDate: scheduleDisplayStartUtc(range.start, leadDays),
      endDate: range.end,
      items,
      isEditable: true,
      isCustomCalendar: Boolean(client.isCustomCalendar),
    });
    createdIndexes.push(i);
  }

  if (!docs.length) {
    return { created: 0, skipped: skippedExisting > 0, createdIndexes: [] };
  }

  try {
    await Schedule.insertMany(docs, { ordered: false });
  } catch (err) {
    const writeErrors = Array.isArray(err?.writeErrors) ? err.writeErrors : [];
    const onlyDupes =
      err?.code === 11000 ||
      (writeErrors.length > 0 && writeErrors.every((w) => Number(w?.code) === 11000));
    if (!onlyDupes) throw err;
  }

  const totalAfter = await Schedule.countDocuments({ clientId });
  if (totalAfter < 3) {
    console.warn(
      `[schedule-init] incomplete months after init clientId=${String(clientId)} total=${Number(
        totalAfter
      )} expected=3`
    );
  } else {
    console.info(
      `[schedule-init] ensured initial months clientId=${String(clientId)} created=${createdIndexes.join(
        ","
      ) || "none"} total=${Number(totalAfter)}`
    );
  }
  return { created: createdIndexes.length, skipped: false, createdIndexes };
}

async function listSchedulesForClient(clientId) {
  let totalMonths = await Schedule.countDocuments({ clientId });
  // Ensure first 3 rows always exist (also heals partial writes: 1/3 or 2/3).
  if (totalMonths < 3) {
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

  const sequentialStart = normalizeUtcMidnight(addDaysUTC(lastMonth.endDate, 1));
  const range = sequentialStart
    ? { start: sequentialStart, end: addDaysUTC(sequentialStart, 29) }
    : getCustomMonthRange(client.startDate, nextIndex);
  const leadDays = resolveDistributionLeadDays(client, {});
  const items = await generateScheduleForRange(client, range, {
    forceWeekendOff: true,
    distributionLeadDays: leadDays,
  });

  const doc = await Schedule.create({
    clientId,
    monthIndex: nextIndex,
    startDate: scheduleDisplayStartUtc(range.start, leadDays),
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

  const anchorLastSchedule = await Schedule.findOne({ clientId }).sort({ monthIndex: -1 }).lean();
  let rollingStart =
    !Number.isFinite(startIndexFromInput) && anchorLastSchedule?.endDate
      ? normalizeUtcMidnight(addDaysUTC(anchorLastSchedule.endDate, 1))
      : null;

  const newSchedules = [];
  for (let i = 0; i < n; i += 1) {
    const monthIndex = startIndex + i;
    const range = rollingStart
      ? { start: rollingStart, end: addDaysUTC(rollingStart, 29) }
      : getCustomMonthRange(client.startDate, monthIndex);
    const leadDays = resolveDistributionLeadDays(client, {});
    const items = await generateScheduleForRange(client, range, {
      forceWeekendOff: true,
      distributionLeadDays: leadDays,
    });
    newSchedules.push({
      clientId,
      monthIndex,
      startDate: scheduleDisplayStartUtc(range.start, leadDays),
      endDate: range.end,
      items,
      isEditable: true,
      isCustomCalendar: Boolean(client.isCustomCalendar),
      editedByManager: false,
      isDraft: true,
    });
    rollingStart = addDaysUTC(range.end, 1);
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
  resolveDistributionLeadDays,
  scheduleDisplayStartUtc,
  generateScheduleForRange,
  generateMonthlySchedule,
  createInitialScheduleForClient,
  listSchedulesForClient,
  createNextMonthSchedule,
  extendSchedules,
  previewExtendSchedules,
  saveExtendedSchedules,
};
