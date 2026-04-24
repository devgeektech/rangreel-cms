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

function buildDisplayIdString({ month, cleanBrand, taskType, taskNumber }) {
  const formattedNumber = String(Number(taskNumber) || 0).padStart(3, "0");
  return `${month}-${cleanBrand}-${taskType}${formattedNumber}`;
}

async function resolveBrandNameForClient(clientId) {
  if (!clientId) return "";
  const client = await Client.findById(clientId).select("brandName clientName").lean();
  return client?.brandName || client?.clientName || "";
}

async function getNextTaskNumber(clientId, taskType) {
  const ContentItem = require("../models/ContentItem");
  const latest = await ContentItem.findOne({ client: clientId, taskType })
    .select("taskNumber")
    .sort({ taskNumber: -1 })
    .lean();
  const prev = Number(latest?.taskNumber) || 0;
  return prev + 1;
}

async function assignDisplayIdFields(item) {
  const taskType = getTaskTypeFromContentType(item?.contentType || item?.type);
  const nextNumber = await getNextTaskNumber(item?.client, taskType);
  const brandName = await resolveBrandNameForClient(item?.client);
  const cleanBrand = cleanBrandName(brandName) || "Brand";
  const month = formatMonthAbbrUTC(getScheduledAnchorDate(item));
  return {
    taskType,
    taskNumber: nextNumber,
    displayId: buildDisplayIdString({
      month,
      cleanBrand,
      taskType,
      taskNumber: nextNumber,
    }),
  };
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
    const key = `${String(row?.client || "")}::${taskType}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push({ row, taskType });
  }

  for (const [key, list] of grouped.entries()) {
    const [clientId, taskType] = key.split("::");
    const latest = await ContentItem.findOne({ client: clientId, taskType })
      .select("taskNumber")
      .sort({ taskNumber: -1 })
      .lean();
    let seq = Number(latest?.taskNumber) || 0;
    const cleanBrand = brandByClient.get(clientId) || "Brand";
    for (const { row } of list) {
      seq += 1;
      const month = formatMonthAbbrUTC(getScheduledAnchorDate(row));
      row.taskType = taskType;
      row.taskNumber = seq;
      row.displayId = buildDisplayIdString({
        month,
        cleanBrand,
        taskType,
        taskNumber: seq,
      });
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
  doc.displayId = buildDisplayIdString({
    month,
    cleanBrand,
    taskType,
    taskNumber,
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
  return buildDisplayIdString({
    month,
    cleanBrand: cleanBrand || "Brand",
    taskType,
    taskNumber,
  });
}

module.exports = {
  getTaskTypeFromContentType,
  cleanBrandName,
  formatMonthAbbrUTC,
  getPlanStageDueDate,
  getScheduledAnchorDate,
  buildDisplayIdString,
  getNextTaskNumber,
  resolveBrandNameForClient,
  assignDisplayIdFields,
  assignDisplayIdFieldsMany,
  rebuildDisplayIdMonthOnly,
  refreshDisplayIdMonthIfNeeded,
  resolveDisplayIdForRead,
};
