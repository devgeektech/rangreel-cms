const ContentItem = require("../models/ContentItem");
const {
  validateStagesNotAfterPosting,
  recalculateStagesFromPosting,
  clampStagesToPosting,
} = require("./stageBoundary.service");

function normalizeUTCDate(ymd) {
  if (!ymd) return null;
  const d = ymd instanceof Date ? ymd : new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function toMonthStringUTC(ymd) {
  const d = normalizeUTCDate(ymd);
  if (!d) return "";
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function contentTypeFromDraftType(type) {
  if (type === "reel") return { contentType: "reel", type: "reel" };
  if (type === "post") return { contentType: "static_post", type: "post" };
  if (type === "carousel") return { contentType: "carousel", type: "carousel" };
  return { contentType: "reel", type: "reel" };
}

async function persistCalendarDraft({ clientId, calendarDraft, createdBy }) {
  const items = Array.isArray(calendarDraft?.items) ? calendarDraft.items : [];
  if (items.length === 0) return { insertedCount: 0, endDate: null };

  let endDate = null;
  const postingDates = [];

  for (const item of items) {
    const { contentType, type } = contentTypeFromDraftType(item.type);
    const postingDate = normalizeUTCDate(item.postingDate);
    if (postingDate) postingDates.push(postingDate);

    const month = postingDate ? toMonthStringUTC(item.postingDate) : toMonthStringUTC(new Date().toISOString());

    const planType = item.planType || "normal";
    const plan = item.plan || planType || "normal";

    let stageSource = item.stages || [];
    const boundary = validateStagesNotAfterPosting(stageSource, postingDate);
    if (!boundary.ok) {
      // If posting date was moved earlier, rebuild stage dates from posting date template.
      const recalculated = recalculateStagesFromPosting({
        itemType: item.type,
        postingDate,
        existingStages: stageSource,
      });
      stageSource = recalculated.stages || stageSource;
    }

    const clamped = clampStagesToPosting(stageSource, postingDate);
    stageSource = clamped.stages || stageSource;

    const workflowStages = stageSource.map((s) => {
      const due = normalizeUTCDate(s.date);
      return {
        stageName: s.name || s.stageName,
        role: s.role,
        assignedUser: s.assignedUser || undefined,
        dueDate: due,
        status: s.status || "assigned",
      };
    });

    await ContentItem.create({
      client: clientId,
      contentType,
      type,
      plan: planType === "urgent" ? "urgent" : "normal",
      planType: planType === "urgent" ? "urgent" : "normal",
      title: item.title || item.contentId || "Untitled",
      month,
      clientPostingDate: postingDate,
      workflowStages,
      createdBy,
    });
  }

  if (postingDates.length > 0) {
    endDate = new Date(Math.max(...postingDates.map((d) => d.getTime())));
  }

  return { insertedCount: items.length, endDate };
}

module.exports = {
  persistCalendarDraft,
};

