const Client = require("../models/Client");

const TASK_TYPE_BY_CONTENT_TYPE = {
  reel: "Reel",
  static_post: "Post",
  post: "Post",
  gmb_post: "Post",
  campaign: "Post",
  carousel: "Carousel",
};

function getTaskTypeFromContentType(contentType) {
  const key = String(contentType || "").toLowerCase();
  return TASK_TYPE_BY_CONTENT_TYPE[key] || "Post";
}

function cleanBrandName(brandName) {
  return String(brandName || "")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9]/g, "");
}

function formatMonthAbbrUTC(dateValue) {
  const d = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(d.getTime())) return "Jan";
  return d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
}

function getPlanStageDueDate(workflowStages) {
  const stages = Array.isArray(workflowStages) ? workflowStages : [];
  const plan = stages.find(
    (s) => String(s?.stageName || "").toLowerCase() === "plan"
  );
  return plan?.dueDate || null;
}

function getScheduledAnchorDate(item) {
  return (
    getPlanStageDueDate(item?.workflowStages) ||
    item?.clientPostingDate ||
    item?.createdAt ||
    new Date()
  );
}

/** Maps cycle index (1–3) to an id segment; empty string if out of range (legacy / omit segment). */
function cycleLabelFromIndex(cycleIndex) {
  const n = Number(cycleIndex);
  if (n === 1) return "First";
  if (n === 2) return "Second";
  if (n === 3) return "Third";
  return "";
}

/**
 * @param {{ month: string, cleanBrand: string, taskType: string, taskNumber: number, cycleLabelText?: string }} args
 * With cycleLabelText: May-nikebrand-First-Reel001. Without: May-nikebrand-Reel001 (legacy).
 */
function buildDisplayIdString({ month, cleanBrand, taskType, taskNumber, cycleLabelText = "" }) {
  const formattedNumber = String(Number(taskNumber) || 0).padStart(3, "0");
  const label = String(cycleLabelText || "").trim();
  if (label) {
    return `${month}-${cleanBrand}-${label}-${taskType}${formattedNumber}`;
  }
  return `${month}-${cleanBrand}-${taskType}${formattedNumber}`;
}

function shouldUseCycleSegment(cycleIndex) {
  const n = Number(cycleIndex);
  return Number.isFinite(n) && n >= 1 && n <= 3;
}

async function resolveBrandNameForClient(clientId) {
  if (!clientId) return "";
  const client = await Client.findById(clientId).select("brandName clientName").lean();
  return client?.brandName || client?.clientName || "";
}

/**
 * Next task number within { client, taskType, cycleIndex } (per-cycle).
 * If cycleIndex is omitted or invalid, falls back to legacy global counter for that client+taskType.
 */
async function getNextTaskNumber(clientId, taskType, cycleIndex) {
  const ContentItem = require("../models/ContentItem");
  const query = { client: clientId, taskType };
  if (shouldUseCycleSegment(cycleIndex)) {
    query.cycleIndex = Number(cycleIndex);
  }
  const latest = await ContentItem.findOne(query).select("taskNumber").sort({ taskNumber: -1 }).lean();
  const prev = Number(latest?.taskNumber) || 0;
  return prev + 1;
}

async function assignDisplayIdFields(item) {
  const taskType = getTaskTypeFromContentType(item?.contentType || item?.type);
  const cycleIdx = item?.cycleIndex;
  const useCycle = shouldUseCycleSegment(cycleIdx);
  const nextNumber = await getNextTaskNumber(
    item?.client,
    taskType,
    useCycle ? Number(cycleIdx) : undefined
  );
  const brandName = await resolveBrandNameForClient(item?.client);
  const cleanBrand = cleanBrandName(brandName) || "Brand";
  const month = formatMonthAbbrUTC(getScheduledAnchorDate(item));
  const cycleLabelText = useCycle ? cycleLabelFromIndex(cycleIdx) : "";
  return {
    taskType,
    taskNumber: nextNumber,
    displayId: buildDisplayIdString({
      month,
      cleanBrand,
      taskType,
      taskNumber: nextNumber,
      cycleLabelText,
    }),
  };
}

function sortRowsForStableNumbering(list) {
  return [...list].sort((a, b) => {
    const ta = String(a?.row?.title || "");
    const tb = String(b?.row?.title || "");
    return ta.localeCompare(tb, undefined, { numeric: true });
  });
}

async function assignDisplayIdFieldsMany(docs) {
  const rows = Array.isArray(docs) ? docs : [];
  if (!rows.length) return;

  const uniqueClientIds = [...new Set(rows.map((d) => String(d?.client || "")).filter(Boolean))];
  const clients = uniqueClientIds.length
    ? await Client.find({ _id: { $in: uniqueClientIds } }).select("_id brandName clientName").lean()
    : [];
  const brandByClient = new Map(
    clients.map((c) => [String(c._id), cleanBrandName(c?.brandName || c?.clientName || "") || "Brand"])
  );

  const ContentItem = require("../models/ContentItem");
  const grouped = new Map();
  for (const row of rows) {
    const taskType = getTaskTypeFromContentType(row?.contentType || row?.type);
    const cyc = row?.cycleIndex;
    const cycleKey = shouldUseCycleSegment(cyc) ? String(Number(cyc)) : "legacy";
    const key = `${String(row?.client || "")}::${taskType}::${cycleKey}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({ row, taskType });
  }

  for (const [key, listRaw] of grouped.entries()) {
    const parts = key.split("::");
    const clientId = parts[0];
    const taskType = parts[1];
    const cycleKey = parts[2];
    const list = sortRowsForStableNumbering(listRaw);

    const query = { client: clientId, taskType };
    if (cycleKey !== "legacy") {
      query.cycleIndex = Number(cycleKey);
    }

    const latest = await ContentItem.findOne(query).select("taskNumber").sort({ taskNumber: -1 }).lean();
    let seq = Number(latest?.taskNumber) || 0;
    const cleanBrand = brandByClient.get(clientId) || "Brand";
    for (const { row } of list) {
      seq += 1;
      const month = formatMonthAbbrUTC(getScheduledAnchorDate(row));
      const useCycle = cycleKey !== "legacy";
      const cycleLabelText = useCycle ? cycleLabelFromIndex(row?.cycleIndex) : "";
      row.taskType = taskType;
      row.taskNumber = seq;
      row.displayId = buildDisplayIdString({
        month,
        cleanBrand,
        taskType,
        taskNumber: seq,
        cycleLabelText,
      });
      row.title = `${taskType} #${seq}`;
    }
  }
}

async function rebuildDisplayIdMonthOnly(doc) {
  const taskType = String(doc?.taskType || "");
  const taskNumber = Number(doc?.taskNumber || 0);
  const hasStableCore = taskType && taskNumber > 0;
  if (!hasStableCore) return;
  const brandName = await resolveBrandNameForClient(doc?.client);
  const cleanBrand = cleanBrandName(brandName) || "Brand";
  const month = formatMonthAbbrUTC(getScheduledAnchorDate(doc));
  const cycleLabelText = shouldUseCycleSegment(doc?.cycleIndex)
    ? cycleLabelFromIndex(doc.cycleIndex)
    : "";
  doc.displayId = buildDisplayIdString({
    month,
    cleanBrand,
    taskType,
    taskNumber,
    cycleLabelText,
  });
}

async function refreshDisplayIdMonthIfNeeded(doc) {
  if (!doc) return;
  await rebuildDisplayIdMonthOnly(doc);
}

function resolveDisplayIdForRead(item) {
  if (!item) return "";
  const existing = String(item.displayId || "").trim();
  if (existing) return existing;
  const taskType = String(item.taskType || getTaskTypeFromContentType(item.contentType || item.type));
  const taskNumber = Number(item.taskNumber || 0);
  if (!taskType || taskNumber <= 0) return "";
  const cleanBrand = cleanBrandName(
    item?.client?.brandName || item?.client?.clientName || item?.brandName || item?.clientBrandName || ""
  );
  const month = formatMonthAbbrUTC(getScheduledAnchorDate(item));
  const cycleLabelText = shouldUseCycleSegment(item?.cycleIndex)
    ? cycleLabelFromIndex(item.cycleIndex)
    : "";
  return buildDisplayIdString({
    month,
    cleanBrand: cleanBrand || "Brand",
    taskType,
    taskNumber,
    cycleLabelText,
  });
}

module.exports = {
  getTaskTypeFromContentType,
  cleanBrandName,
  formatMonthAbbrUTC,
  getPlanStageDueDate,
  getScheduledAnchorDate,
  cycleLabelFromIndex,
  buildDisplayIdString,
  getNextTaskNumber,
  resolveBrandNameForClient,
  assignDisplayIdFields,
  assignDisplayIdFieldsMany,
  rebuildDisplayIdMonthOnly,
  refreshDisplayIdMonthIfNeeded,
  resolveDisplayIdForRead,
};
