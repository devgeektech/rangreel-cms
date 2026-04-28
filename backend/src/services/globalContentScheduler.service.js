const Client = require("../models/Client");
const ContentItem = require("../models/ContentItem");
const PublicHoliday = require("../models/PublicHoliday");
const { BACKWARD_OFFSETS } = require("./workflowFromPostingDate.service");
const { getEffectiveCapacity } = require("../utils/capacityResolver");

const MIX_BUCKETS = ["reel", "static_post", "carousel"];
const DAILY_MIX_TARGET = {
  reel: 2,
  static_post: 2,
  carousel: 2,
};
const URGENT_REEL_RESERVE = 2;

function createUTCDate(date) {
  const d = date instanceof Date ? new Date(date) : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDaysUTC(date, days) {
  const d = createUTCDate(date);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toMonthStringUTC(date) {
  const d = createUTCDate(date);
  if (!d) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function ymdUTC(date) {
  const d = createUTCDate(date);
  if (!d) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

async function buildHolidaySetUTC(startDate, endDate) {
  const start = createUTCDate(startDate);
  const end = createUTCDate(endDate);
  if (!start || !end) return new Set();
  const endPlus = addDaysUTC(end, 1);
  const docs = await PublicHoliday.find({ date: { $gte: start, $lt: endPlus } }).select("date").lean();
  const set = new Set();
  for (const row of docs || []) {
    const key = ymdUTC(row.date);
    if (key) set.add(key);
  }
  return set;
}

function isWeekendUTC(date) {
  const d = createUTCDate(date);
  if (!d) return false;
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}

function isNonWorkingDayUTC(date, holidaySet, allowWeekend = false) {
  const key = ymdUTC(date);
  if (!allowWeekend && isWeekendUTC(date)) return true;
  return Boolean(key && holidaySet && holidaySet.has(key));
}

function countWorkingDaysInRange(startDate, endDate, holidaySet, allowWeekend = false) {
  const start = createUTCDate(startDate);
  const end = createUTCDate(endDate);
  if (!start || !end || start.getTime() > end.getTime()) return 0;
  let count = 0;
  for (let d = start; d && d.getTime() <= end.getTime(); d = addDaysUTC(d, 1)) {
    if (!isNonWorkingDayUTC(d, holidaySet, allowWeekend)) count += 1;
  }
  return count;
}

function computeDynamicTrancheSize(tasks, cycleRange, holidaySet, allowWeekend = false) {
  const workingDays = Math.max(
    1,
    countWorkingDaysInRange(cycleRange?.start, cycleRange?.end, holidaySet, allowWeekend)
  );
  const counts = {
    reel: 0,
    static_post: 0,
    carousel: 0,
  };
  for (const task of tasks || []) {
    if (task?.isCompleted) continue;
    const bucket = getEffectiveBucket(task?.contentType);
    counts[bucket] += 1;
  }
  const activeBuckets = MIX_BUCKETS.filter((b) => counts[b] > 0);
  if (!activeBuckets.length) return 1;

  const minTarget = Math.max(
    1,
    Math.min(...activeBuckets.map((b) => Math.max(1, Number(DAILY_MIX_TARGET[b]) || 1)))
  );
  const capacityBased = workingDays * minTarget;
  const minAvailable = Math.min(...activeBuckets.map((b) => counts[b]));
  return Math.max(1, Math.min(capacityBased, minAvailable));
}

function assignBatchGroups(tasks, trancheSize) {
  const n = Math.max(1, Number(trancheSize) || 1);
  const cursor = {
    reel: 0,
    static_post: 0,
    carousel: 0,
  };
  for (const task of tasks || []) {
    const bucket = getEffectiveBucket(task?.contentType);
    cursor[bucket] += 1;
    task.batchGroup = Math.floor((cursor[bucket] - 1) / n);
  }
}

async function buildSeedDayUsageMap(cycleRange, options = {}) {
  const start = createUTCDate(cycleRange?.start);
  const end = createUTCDate(cycleRange?.end);
  if (!start || !end) return new Map();

  const excludeClientIds = Array.isArray(options.excludeClientIds)
    ? options.excludeClientIds.filter(Boolean).map((id) => String(id))
    : [];

  const query = {
    "workflowStages.dueDate": { $gte: start, $lte: end },
  };
  if (excludeClientIds.length) {
    query.client = { $nin: excludeClientIds };
  }

  const rows = await ContentItem.find(query)
    .select("contentType workflowStages.role workflowStages.assignedUser workflowStages.dueDate workflowStages.status client")
    .lean();

  const seeded = new Map();
  for (const item of rows || []) {
    const contentType = getEffectiveBucket(item?.contentType);
    for (const ws of item?.workflowStages || []) {
      const due = createUTCDate(ws?.dueDate);
      const role = String(ws?.role || "");
      const uid = ws?.assignedUser ? String(ws.assignedUser) : "";
      const status = String(ws?.status || "").toLowerCase();
      if (!due || !role || !uid) continue;
      if (status === "completed" || status === "posted") continue;
      const key = `${ymdUTC(due)}|${role}|${uid}|${contentType}`;
      seeded.set(key, (seeded.get(key) || 0) + 1);
    }
  }
  return seeded;
}

function getPipelineRows(contentType, planType) {
  if (contentType === "reel") {
    return planType === "urgent" ? BACKWARD_OFFSETS.reelUrgent || [] : BACKWARD_OFFSETS.reel || [];
  }
  return BACKWARD_OFFSETS.post || [];
}

function buildPipeline(contentType, planType) {
  const rows = getPipelineRows(contentType, planType);
  return rows.map((row, index) => {
    const prev = rows[index - 1];
    const derivedMinGap = prev
      ? Math.max(0, Number(prev.daysBeforePost || 0) - Number(row.daysBeforePost || 0))
      : 0;
    const configuredMinGap = Number(row.minGap);
    const minGap = Number.isFinite(configuredMinGap) ? Math.max(0, configuredMinGap) : derivedMinGap;
    return {
      stageName: row.stageName,
      role: row.role,
      minGap,
    };
  });
}

function getTeamForType(team, type) {
  const t = team || {};
  if (type === "reel") return t.reels || {};
  if (type === "static_post") return t.posts || {};
  return t.carousel || {};
}

function getActiveCounts(client) {
  const active = client?.activeContentCounts || {};
  if (
    Number.isFinite(active.noOfReels) ||
    Number.isFinite(active.noOfStaticPosts) ||
    Number.isFinite(active.noOfCarousels)
  ) {
    return {
      reels: Math.max(0, Number(active.noOfReels) || 0),
      posts: Math.max(0, Number(active.noOfStaticPosts) || 0),
      carousels: Math.max(0, Number(active.noOfCarousels) || 0),
    };
  }
  const pkg = client?.package || {};
  return {
    reels: Math.max(0, Number(pkg.noOfReels) || 0),
    posts: Math.max(0, (Number(pkg.noOfPosts) || 0) + (Number(pkg.noOfStaticPosts) || 0)),
    carousels: Math.max(0, Number(pkg.noOfCarousels) || 0),
  };
}

function buildCycles(clientStartDate) {
  const start = createUTCDate(clientStartDate);
  if (!start) return [];
  const month1Start = addDaysUTC(start, 1);
  const month2Start = addDaysUTC(start, 30);
  const month3Start = addDaysUTC(start, 60);
  return [
    { index: 1, start: month1Start, end: addDaysUTC(month1Start, 29) },
    { index: 2, start: month2Start, end: addDaysUTC(start, 59) },
    { index: 3, start: month3Start, end: addDaysUTC(start, 89) },
  ];
}

function priorityRank(contentType, planType) {
  if (contentType === "reel" && planType === "urgent") return 0;
  if (contentType === "reel") return 1;
  if (contentType === "static_post") return 2;
  return 3;
}

function cloneBlueprint(blueprint) {
  return blueprint.map((item) => ({
    ...item,
    postingDate: null,
    isCompleted: false,
    currentStageIndex: 0,
    stages: item.stages.map((s) => ({
      ...s,
      dueDate: null,
      status: "planned",
      earliestStartDate: createUTCDate(s.earliestStartDate),
    })),
  }));
}

function sortTasks(a, b) {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const ea = a.stages[a.currentStageIndex]?.earliestStartDate?.getTime?.() || 0;
  const eb = b.stages[b.currentStageIndex]?.earliestStartDate?.getTime?.() || 0;
  if (ea !== eb) return ea - eb;
  if (a.clientSortKey !== b.clientSortKey) return a.clientSortKey.localeCompare(b.clientSortKey);
  const ta = String(a.title || "");
  const tb = String(b.title || "");
  const na = Number((ta.match(/#\s*(\d+)/) || [])[1]);
  const nb = Number((tb.match(/#\s*(\d+)/) || [])[1]);
  const hasNa = Number.isFinite(na);
  const hasNb = Number.isFinite(nb);
  if (hasNa && hasNb && na !== nb) return na - nb;
  return ta.localeCompare(tb);
}

function getEffectiveBucket(contentType) {
  const t = String(contentType || "").toLowerCase();
  if (t === "reel") return "reel";
  if (t === "carousel") return "carousel";
  return "static_post";
}

function sumRemaining(remainingByType) {
  let total = 0;
  for (const key of MIX_BUCKETS) {
    const n = remainingByType[key];
    if (!Number.isFinite(n)) return Number.POSITIVE_INFINITY;
    total += Math.max(0, Number(n) || 0);
  }
  return total;
}

function takeAssignableTasks(candidates, remainingByType, maxTake) {
  const picked = [];
  if (!Array.isArray(candidates) || !candidates.length || maxTake <= 0) return picked;
  for (const task of candidates) {
    if (picked.length >= maxTake) break;
    const bucket = getEffectiveBucket(task.contentType);
    const left = remainingByType[bucket];
    if (Number.isFinite(left) && left <= 0) continue;
    picked.push(task);
    if (Number.isFinite(left)) remainingByType[bucket] = left - 1;
  }
  return picked;
}

function getActiveBatchGroupForRoleUser(tasks, role, userKey) {
  const minByBucket = {
    reel: Number.POSITIVE_INFINITY,
    static_post: Number.POSITIVE_INFINITY,
    carousel: Number.POSITIVE_INFINITY,
  };
  for (const task of tasks || []) {
    if (task?.isCompleted) continue;
    const stage = task?.stages?.[task?.currentStageIndex];
    if (!stage || String(stage.role || "") !== String(role || "")) continue;
    if (String(stage.assignedUser || "") !== String(userKey || "")) continue;
    const bucket = getEffectiveBucket(task.contentType);
    const grp = Number(task.batchGroup);
    const g = Number.isFinite(grp) && grp >= 0 ? grp : 0;
    if (g < minByBucket[bucket]) minByBucket[bucket] = g;
  }
  const values = Object.values(minByBucket).filter((n) => Number.isFinite(n));
  if (!values.length) return null;
  return Math.min(...values);
}

async function runCycleScheduling(tasks, cycleRange, useOverload, options = {}) {
  const holidaySet = options.holidaySet || new Set();
  const allowWeekend = options.allowWeekend === true;
  const balancedOverload = options.balancedOverload !== false;
  const enforceTranche = options.enforceTranche !== false;
  const overloadSpreadFactor = Math.max(1, Number(options.overloadSpreadFactor) || 1);
  const seedUsageMap =
    options.seedUsageMap instanceof Map ? options.seedUsageMap : new Map();
  const dayUsage = new Map(seedUsageMap);
  const capCache = new Map();
  const roleUsers = new Map();
  const roles = new Set();
  for (const task of tasks) {
    for (const st of task.stages) {
      roles.add(st.role);
      if (!roleUsers.has(st.role)) roleUsers.set(st.role, new Set());
      roleUsers.get(st.role).add(String(st.assignedUser || ""));
    }
  }

  const start = createUTCDate(cycleRange.start);
  const end = createUTCDate(cycleRange.end);
  for (let current = start; current && end && current.getTime() <= end.getTime(); current = addDaysUTC(current, 1)) {
    if (isNonWorkingDayUTC(current, holidaySet, allowWeekend)) continue;
    for (const role of Array.from(roles).sort()) {
      const users = Array.from(roleUsers.get(role) || []).sort();
      for (const userKey of users) {
        const eligible = tasks
          .filter((task) => {
            if (task.isCompleted) return false;
            const stage = task.stages[task.currentStageIndex];
            if (!stage || stage.role !== role) return false;
            if (String(stage.assignedUser || "") !== userKey) return false;
            const es = createUTCDate(stage.earliestStartDate);
            if (!es || es.getTime() > current.getTime()) return false;
            return true;
          })
          .sort(sortTasks);

        if (eligible.length === 0) continue;

        let effectiveEligible = eligible;
        if (useOverload && balancedOverload && enforceTranche) {
          const activeBatchGroup = getActiveBatchGroupForRoleUser(tasks, role, userKey);
          if (Number.isFinite(activeBatchGroup)) {
            const trancheEligible = eligible.filter((task) => {
              const grp = Number(task.batchGroup);
              const g = Number.isFinite(grp) && grp >= 0 ? grp : 0;
              return g === activeBatchGroup;
            });
            if (trancheEligible.length > 0) {
              effectiveEligible = trancheEligible.sort(sortTasks);
            }
          }
        }

        let maxDailyAssignments = Number.POSITIVE_INFINITY;
        if (useOverload && balancedOverload) {
          const pendingTotalForRoleUser = tasks.filter((task) => {
            if (task?.isCompleted) return false;
            const stage = task?.stages?.[task?.currentStageIndex];
            if (!stage || String(stage.role || "") !== String(role || "")) return false;
            return String(stage.assignedUser || "") === String(userKey || "");
          }).length;
          const remainingWorkDays = Math.max(
            1,
            countWorkingDaysInRange(current, end, holidaySet, allowWeekend)
          );
          maxDailyAssignments = Math.max(
            1,
            Math.ceil((pendingTotalForRoleUser / remainingWorkDays) * overloadSpreadFactor)
          );
        }

        const remainingByType = {
          reel: Number.POSITIVE_INFINITY,
          static_post: Number.POSITIVE_INFINITY,
          carousel: Number.POSITIVE_INFINITY,
        };
        if (!useOverload && userKey) {
          for (const bucket of MIX_BUCKETS) {
            const cacheKey = `${role}|${userKey}|${bucket}`;
            if (!capCache.has(cacheKey)) {
              const v = await getEffectiveCapacity(userKey, role, bucket);
              capCache.set(cacheKey, Number(v) <= 0 ? Number.POSITIVE_INFINITY : Number(v));
            }
            const cap = capCache.get(cacheKey);
            const usageKey = `${ymdUTC(current)}|${role}|${userKey}|${bucket}`;
            const used = dayUsage.get(usageKey) || 0;
            remainingByType[bucket] = Number.isFinite(cap) ? Math.max(0, cap - used) : Number.POSITIVE_INFINITY;
          }
        } else if (useOverload && userKey && balancedOverload) {
          // Overload balancing: distribute pending same-role tasks across remaining working days
          // so large batches (e.g. 100/100/100) don't collapse into the earliest dates.
          const remainingWorkDays = Math.max(
            1,
            countWorkingDaysInRange(current, end, holidaySet, allowWeekend)
          );
          for (const bucket of MIX_BUCKETS) {
            const pendingCount = tasks.filter((task) => {
              if (task.isCompleted) return false;
              const stage = task.stages[task.currentStageIndex];
              if (!stage || stage.role !== role) return false;
              if (String(stage.assignedUser || "") !== userKey) return false;
              return getEffectiveBucket(task.contentType) === bucket;
            }).length;
            const targetPerDay = Math.max(
              1,
              Math.ceil((pendingCount / remainingWorkDays) * overloadSpreadFactor)
            );
            const usageKey = `${ymdUTC(current)}|${role}|${userKey}|${bucket}`;
            const used = dayUsage.get(usageKey) || 0;
            remainingByType[bucket] = Math.max(0, targetPerDay - used);
          }
        }

        let remaining = sumRemaining(remainingByType);
        if (remaining <= 0) continue;

        const urgentReels = effectiveEligible.filter(
          (task) => getEffectiveBucket(task.contentType) === "reel" && String(task.planType || "") === "urgent"
        );
        const normalPool = effectiveEligible.filter(
          (task) => !(getEffectiveBucket(task.contentType) === "reel" && String(task.planType || "") === "urgent")
        );
        const normalByType = {
          reel: normalPool.filter((task) => getEffectiveBucket(task.contentType) === "reel"),
          static_post: normalPool.filter((task) => getEffectiveBucket(task.contentType) === "static_post"),
          carousel: normalPool.filter((task) => getEffectiveBucket(task.contentType) === "carousel"),
        };

        const selected = [];
        let remainingSlots = Number.isFinite(maxDailyAssignments)
          ? Math.max(0, maxDailyAssignments)
          : Number.POSITIVE_INFINITY;
        selected.push(
          ...takeAssignableTasks(
            urgentReels,
            remainingByType,
            Math.min(remaining, URGENT_REEL_RESERVE, remainingSlots)
          )
        );
        remainingSlots = Number.isFinite(remainingSlots)
          ? Math.max(0, remainingSlots - selected.length)
          : remainingSlots;
        remaining = sumRemaining(remainingByType);

        for (const bucket of MIX_BUCKETS) {
          if (remaining <= 0 || remainingSlots <= 0) break;
          const quota = Math.max(0, Number(DAILY_MIX_TARGET[bucket]) || 0);
          const picked = takeAssignableTasks(
            normalByType[bucket],
            remainingByType,
            Math.min(remaining, quota, remainingSlots)
          );
          selected.push(...picked);
          remainingSlots = Number.isFinite(remainingSlots)
            ? Math.max(0, remainingSlots - picked.length)
            : remainingSlots;
          remaining = sumRemaining(remainingByType);
        }

        if (remaining > 0 && remainingSlots > 0) {
          const selectedSet = new Set(selected);
          const backfill = effectiveEligible.filter((task) => !selectedSet.has(task));
          selected.push(
            ...takeAssignableTasks(backfill, remainingByType, Math.min(remaining, remainingSlots))
          );
        }

        for (const task of selected) {
          const st = task.stages[task.currentStageIndex];
          st.dueDate = createUTCDate(current);
          st.status = "assigned";

          if (task.currentStageIndex === task.stages.length - 1) {
            task.isCompleted = true;
            task.postingDate = createUTCDate(current);
          } else {
            const nextStage = task.stages[task.currentStageIndex + 1];
            nextStage.earliestStartDate = addDaysUTC(current, Math.max(0, Number(nextStage.minGap) || 0));
            task.currentStageIndex += 1;
          }
          const bucket = getEffectiveBucket(task.contentType);
          const usageKey = `${ymdUTC(current)}|${role}|${userKey}|${bucket}`;
          dayUsage.set(usageKey, (dayUsage.get(usageKey) || 0) + 1);
        }
      }
    }
  }

  return tasks.every((t) => t.isCompleted && t.postingDate && t.postingDate.getTime() <= end.getTime());
}

async function scheduleCycleWithFallback(blueprintTasks, cycleRange) {
  const holidaySet = await buildHolidaySetUTC(cycleRange.start, cycleRange.end);
  const excludeClientIds = Array.from(
    new Set((blueprintTasks || []).map((t) => (t?.clientId ? String(t.clientId) : null)).filter(Boolean))
  );
  const seedUsageMap = await buildSeedDayUsageMap(cycleRange, { excludeClientIds });
  const normalRun = cloneBlueprint(blueprintTasks);
  const okNormal = await runCycleScheduling(normalRun, cycleRange, false, {
    holidaySet,
    allowWeekend: false,
    seedUsageMap,
  });
  if (okNormal) return { tasks: normalRun, overloadMode: false };

  const overloadRun = cloneBlueprint(blueprintTasks);
  const dynamicTrancheSize = computeDynamicTrancheSize(
    overloadRun,
    cycleRange,
    holidaySet,
    false
  );
  assignBatchGroups(overloadRun, dynamicTrancheSize);
  const okOverload = await runCycleScheduling(overloadRun, cycleRange, true, {
    holidaySet,
    allowWeekend: false,
    // Overload should ignore pre-booked load from other clients; only track current run.
    seedUsageMap: new Map(),
    balancedOverload: true,
    enforceTranche: true,
    overloadSpreadFactor: 1,
  });
  if (okOverload) return { tasks: overloadRun, overloadMode: true };

  // Relax tranche gate but keep balanced day-wise spreading.
  const relaxedOverloadRun = cloneBlueprint(blueprintTasks);
  assignBatchGroups(relaxedOverloadRun, dynamicTrancheSize);
  const okRelaxedOverload = await runCycleScheduling(relaxedOverloadRun, cycleRange, true, {
    holidaySet,
    allowWeekend: false,
    seedUsageMap: new Map(),
    balancedOverload: true,
    enforceTranche: false,
    overloadSpreadFactor: 1,
  });
  if (okRelaxedOverload) return { tasks: relaxedOverloadRun, overloadMode: true };

  // Repeat-loop relaxation: keep balanced logic and gradually increase day allowance.
  for (const factor of [1.5, 2, 3, 5, 8, 12]) {
    const loopRun = cloneBlueprint(blueprintTasks);
    assignBatchGroups(loopRun, dynamicTrancheSize);
    const okLoop = await runCycleScheduling(loopRun, cycleRange, true, {
      holidaySet,
      allowWeekend: false,
      seedUsageMap: new Map(),
      balancedOverload: true,
      enforceTranche: false,
      overloadSpreadFactor: factor,
    });
    if (okLoop) return { tasks: loopRun, overloadMode: true };
  }
  throw new Error(`Unable to schedule cycle ${cycleRange.index} within 30-day window`);
}

function toContentItemDoc(task) {
  const postingDate = createUTCDate(task.postingDate);
  return {
    client: task.clientId,
    contentType: task.contentType,
    type: task.type,
    plan: task.planType === "urgent" ? "urgent" : "normal",
    planType: task.planType,
    title: task.title,
    cycleIndex: task.cycleIndex,
    month: toMonthStringUTC(postingDate),
    clientPostingDate: postingDate,
    workflowStages: task.stages.map((s) => ({
      stageName: s.stageName,
      role: s.role,
      assignedUser: s.assignedUser || undefined,
      dueDate: createUTCDate(s.dueDate),
      status: "assigned",
    })),
    isCustomCalendar: Boolean(task.isCustomCalendar),
    weekendEnabled: Boolean(task.weekendEnabled),
    createdBy: task.createdBy || undefined,
  };
}

async function generateGlobalCalendarForClients(clientIds = []) {
  const ids = (Array.isArray(clientIds) ? clientIds : []).filter(Boolean);
  if (!ids.length) return { insertedCount: 0, overloadCycles: [], clientEndDates: {} };

  const clients = await Client.find({ _id: { $in: ids } })
    .populate("package")
    .select("startDate manager createdBy package team activeContentCounts isCustomCalendar weekendEnabled")
    .lean();
  if (!clients.length) return { insertedCount: 0, overloadCycles: [], clientEndDates: {} };

  const blueprintByCycle = new Map([[1, []], [2, []], [3, []]]);

  for (const client of clients) {
    const counts = getActiveCounts(client);
    const cycles = buildCycles(client.startDate);
    const team = client.team || {};
    for (const cycle of cycles) {
      const bucket = blueprintByCycle.get(cycle.index);
      // Keep legacy urgency policy: only first 2 reels are urgent.
      const urgentCount = Math.min(2, counts.reels);

      for (let i = 1; i <= counts.reels; i++) {
        const planType = i <= urgentCount ? "urgent" : "normal";
        const pipeline = buildPipeline("reel", planType);
        bucket.push({
          clientId: client._id,
          clientSortKey: String(client._id),
          cycleIndex: cycle.index,
          cycleEnd: createUTCDate(cycle.end),
          contentType: "reel",
          type: "reel",
          title: `Reel #${i}`,
          planType,
          priority: priorityRank("reel", planType),
          isCustomCalendar: Boolean(client.isCustomCalendar),
          weekendEnabled: Boolean(client.weekendEnabled),
          createdBy: client.createdBy || client.manager,
          stages: pipeline.map((p, idx) => ({
            ...p,
            assignedUser: getTeamForType(team, "reel")[p.role] || null,
            earliestStartDate: idx === 0 ? createUTCDate(cycle.start) : null,
          })),
        });
      }

      for (let i = 1; i <= counts.posts; i++) {
        const pipeline = buildPipeline("static_post", "standard");
        bucket.push({
          clientId: client._id,
          clientSortKey: String(client._id),
          cycleIndex: cycle.index,
          cycleEnd: createUTCDate(cycle.end),
          contentType: "static_post",
          type: "post",
          title: `Post #${i}`,
          planType: "standard",
          priority: priorityRank("static_post", "standard"),
          isCustomCalendar: Boolean(client.isCustomCalendar),
          weekendEnabled: Boolean(client.weekendEnabled),
          createdBy: client.createdBy || client.manager,
          stages: pipeline.map((p, idx) => ({
            ...p,
            assignedUser: getTeamForType(team, "static_post")[p.role] || null,
            earliestStartDate: idx === 0 ? createUTCDate(cycle.start) : null,
          })),
        });
      }

      for (let i = 1; i <= counts.carousels; i++) {
        const pipeline = buildPipeline("carousel", "standard");
        bucket.push({
          clientId: client._id,
          clientSortKey: String(client._id),
          cycleIndex: cycle.index,
          cycleEnd: createUTCDate(cycle.end),
          contentType: "carousel",
          type: "carousel",
          title: `Carousel #${i}`,
          planType: "standard",
          priority: priorityRank("carousel", "standard"),
          isCustomCalendar: Boolean(client.isCustomCalendar),
          weekendEnabled: Boolean(client.weekendEnabled),
          createdBy: client.createdBy || client.manager,
          stages: pipeline.map((p, idx) => ({
            ...p,
            assignedUser: getTeamForType(team, "carousel")[p.role] || null,
            earliestStartDate: idx === 0 ? createUTCDate(cycle.start) : null,
          })),
        });
      }
    }
  }

  await ContentItem.deleteMany({ client: { $in: ids }, type: { $in: ["reel", "post", "carousel"] } });

  const overloadCycles = [];
  const docs = [];
  for (const cycleIndex of [1, 2, 3]) {
    const tasks = blueprintByCycle.get(cycleIndex) || [];
    if (!tasks.length) continue;
    const cycleStart = tasks.reduce((m, t) => (m && m.getTime() < t.stages[0].earliestStartDate.getTime() ? m : t.stages[0].earliestStartDate), null);
    const cycleEnd = tasks.reduce((m, t) => (m && m.getTime() > t.cycleEnd.getTime() ? m : t.cycleEnd), null);
    const result = await scheduleCycleWithFallback(tasks, { index: cycleIndex, start: cycleStart, end: cycleEnd });
    if (result.overloadMode) overloadCycles.push(cycleIndex);
    docs.push(...result.tasks.map(toContentItemDoc));
  }

  if (docs.length) {
    await ContentItem.insertMany(docs, { ordered: false });
  }

  const clientEndDates = {};
  for (const doc of docs) {
    const key = String(doc.client);
    const cur = clientEndDates[key];
    const candidate = createUTCDate(doc.clientPostingDate);
    if (!cur || (candidate && candidate.getTime() > cur.getTime())) {
      clientEndDates[key] = candidate;
    }
  }

  await Promise.all(
    Object.entries(clientEndDates).map(([clientId, endDate]) =>
      Client.updateOne({ _id: clientId }, { $set: { endDate: createUTCDate(endDate) } })
    )
  );

  return {
    insertedCount: docs.length,
    overloadCycles,
    clientEndDates,
  };
}

function buildClientBlueprintTasks(client) {
  const counts = getActiveCounts(client);
  const cycles = buildCycles(client.startDate);
  const team = client.team || {};
  const blueprintByCycle = new Map([[1, []], [2, []], [3, []]]);

  for (const cycle of cycles) {
    const bucket = blueprintByCycle.get(cycle.index);
    // Keep legacy urgency policy: only first 2 reels are urgent.
    const urgentCount = Math.min(2, counts.reels);

    for (let i = 1; i <= counts.reels; i++) {
      const planType = i <= urgentCount ? "urgent" : "normal";
      const pipeline = buildPipeline("reel", planType);
      bucket.push({
        clientId: client._id || null,
        clientSortKey: String(client._id || "preview-client"),
        cycleIndex: cycle.index,
        cycleEnd: createUTCDate(cycle.end),
        contentType: "reel",
        type: "reel",
        title: `Reel #${i}`,
        planType,
        priority: priorityRank("reel", planType),
        isCustomCalendar: Boolean(client.isCustomCalendar),
        weekendEnabled: Boolean(client.weekendEnabled),
        createdBy: client.createdBy || client.manager || null,
        stages: pipeline.map((p, idx) => ({
          ...p,
          assignedUser: getTeamForType(team, "reel")[p.role] || null,
          earliestStartDate: idx === 0 ? createUTCDate(cycle.start) : null,
        })),
      });
    }

    for (let i = 1; i <= counts.posts; i++) {
      const pipeline = buildPipeline("static_post", "standard");
      bucket.push({
        clientId: client._id || null,
        clientSortKey: String(client._id || "preview-client"),
        cycleIndex: cycle.index,
        cycleEnd: createUTCDate(cycle.end),
        contentType: "static_post",
        type: "post",
        title: `Post #${i}`,
        planType: "standard",
        priority: priorityRank("static_post", "standard"),
        isCustomCalendar: Boolean(client.isCustomCalendar),
        weekendEnabled: Boolean(client.weekendEnabled),
        createdBy: client.createdBy || client.manager || null,
        stages: pipeline.map((p, idx) => ({
          ...p,
          assignedUser: getTeamForType(team, "static_post")[p.role] || null,
          earliestStartDate: idx === 0 ? createUTCDate(cycle.start) : null,
        })),
      });
    }

    for (let i = 1; i <= counts.carousels; i++) {
      const pipeline = buildPipeline("carousel", "standard");
      bucket.push({
        clientId: client._id || null,
        clientSortKey: String(client._id || "preview-client"),
        cycleIndex: cycle.index,
        cycleEnd: createUTCDate(cycle.end),
        contentType: "carousel",
        type: "carousel",
        title: `Carousel #${i}`,
        planType: "standard",
        priority: priorityRank("carousel", "standard"),
        isCustomCalendar: Boolean(client.isCustomCalendar),
        weekendEnabled: Boolean(client.weekendEnabled),
        createdBy: client.createdBy || client.manager || null,
        stages: pipeline.map((p, idx) => ({
          ...p,
          assignedUser: getTeamForType(team, "carousel")[p.role] || null,
          earliestStartDate: idx === 0 ? createUTCDate(cycle.start) : null,
        })),
      });
    }
  }

  return blueprintByCycle;
}

async function generateGlobalCalendarDraft({
  packageCounts,
  startDate,
  team,
  contentEnabled = {},
  managerId = null,
  createdBy = null,
  isCustomCalendar = true,
  weekendEnabled = false,
}) {
  const reels = contentEnabled.reels === false ? 0 : Number(packageCounts?.noOfReels) || 0;
  const posts =
    contentEnabled.posts === false
      ? 0
      : (Number(packageCounts?.noOfPosts) || 0) + (Number(packageCounts?.noOfStaticPosts) || 0);
  const carousels = contentEnabled.carousel === false ? 0 : Number(packageCounts?.noOfCarousels) || 0;

  const pseudoClient = {
    _id: null,
    startDate,
    manager: managerId,
    createdBy: createdBy || managerId || null,
    team: team || {},
    activeContentCounts: {
      noOfReels: reels,
      noOfStaticPosts: posts,
      noOfCarousels: carousels,
    },
    isCustomCalendar,
    weekendEnabled,
  };

  const blueprintByCycle = buildClientBlueprintTasks(pseudoClient);
  const overloadCycles = [];
  const allTasks = [];
  const cycleRanges = [];
  const schedule = {};

  for (const cycleIndex of [1, 2, 3]) {
    const tasks = blueprintByCycle.get(cycleIndex) || [];
    if (!tasks.length) {
      schedule[`M${cycleIndex}`] = {
        monthIndex: cycleIndex - 1,
        start: null,
        end: null,
        nominalEnd: null,
        overflowed: false,
        items: [],
      };
      continue;
    }
    const cycleStart = tasks.reduce(
      (m, t) => (m && m.getTime() < t.stages[0].earliestStartDate.getTime() ? m : t.stages[0].earliestStartDate),
      null
    );
    const cycleEnd = tasks.reduce((m, t) => (m && m.getTime() > t.cycleEnd.getTime() ? m : t.cycleEnd), null);
    const result = await scheduleCycleWithFallback(tasks, { index: cycleIndex, start: cycleStart, end: cycleEnd });
    if (result.overloadMode) overloadCycles.push(cycleIndex);

    const cycleDocs = result.tasks.map(toContentItemDoc);
    allTasks.push(...result.tasks);
    const maxPosting =
      cycleDocs.length > 0
        ? cycleDocs.reduce(
            (m, row) =>
              !m || createUTCDate(row.clientPostingDate).getTime() > createUTCDate(m).getTime()
                ? row.clientPostingDate
                : m,
            null
          )
        : cycleEnd;
    schedule[`M${cycleIndex}`] = {
      monthIndex: cycleIndex - 1,
      start: createUTCDate(cycleStart),
      end: createUTCDate(maxPosting || cycleEnd),
      nominalEnd: createUTCDate(cycleEnd),
      overflowed: false,
      items: cycleDocs.map((row) => ({
        contentId: row.title,
        title: row.title,
        type: row.type,
        planType: row.planType,
        postingDate: ymdUTC(row.clientPostingDate),
        cycleIndex: row.cycleIndex,
        stages: (row.workflowStages || []).map((s) => ({
          name: s.stageName,
          role: s.role,
          assignedUser: s.assignedUser || null,
          date: ymdUTC(s.dueDate),
          status: s.status || "assigned",
        })),
      })),
    };
    cycleRanges.push({
      monthIndex: cycleIndex - 1,
      start: createUTCDate(cycleStart),
      end: createUTCDate(maxPosting || cycleEnd),
      nominalEnd: createUTCDate(cycleEnd),
      overflowed: false,
    });
  }

  const items = allTasks
    .map(toContentItemDoc)
    .sort((a, b) => createUTCDate(a.clientPostingDate).getTime() - createUTCDate(b.clientPostingDate).getTime())
    .map((row) => ({
      contentId: row.title,
      title: row.title,
      type: row.type,
      planType: row.planType,
      postingDate: ymdUTC(row.clientPostingDate),
      cycleIndex: row.cycleIndex,
      stages: (row.workflowStages || []).map((s) => ({
        name: s.stageName,
        role: s.role,
        assignedUser: s.assignedUser || null,
        date: ymdUTC(s.dueDate),
        status: s.status || "assigned",
      })),
    }));
  const endDate = items.length
    ? items.reduce((m, it) => (!m || it.postingDate > m ? it.postingDate : m), "")
    : null;

  return {
    items,
    schedule,
    endDate,
    activeContentCounts: {
      noOfReels: reels,
      noOfStaticPosts: posts,
      noOfCarousels: carousels,
    },
    cycleRanges,
    overloadCycles,
  };
}

module.exports = {
  generateGlobalCalendarForClients,
  generateGlobalCalendarDraft,
  buildPipeline,
};
