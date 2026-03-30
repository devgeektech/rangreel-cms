const Client = require("../models/Client");
const ClientScheduleDraft = require("../models/ClientScheduleDraft");
const ContentItem = require("../models/ContentItem");
const {
  getNextAvailableDate,
  suggestNextAvailableSlots,
} = require("../services/capacityAvailability.service");

const success = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

const failure = (res, error, statusCode = 400) =>
  res.status(statusCode).json({ success: false, error });

const toYMD = (value) => {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
};

const addDaysUTC = (date, days) => {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
};

const normalizeUTCDate = (value) => {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

const USER_EDITABLE_STAGES = new Set(["Plan", "Shoot", "Edit", "Approval"]);

const isSameUTCDate = (a, b) => {
  if (!a || !b) return false;
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
};

const canAccessDraft = async (req, clientId, draft) => {
  // Admin can read any draft.
  if (req.user?.roleType === "admin") return true;

  // Manager can read draft of own client.
  if (req.user?.roleType === "manager") {
    const owned = await Client.findOne({ _id: clientId, manager: req.user.id })
      .select("_id")
      .lean();
    return Boolean(owned);
  }

  // Team users can read if assigned to any stage in the draft.
  if (req.user?.roleType === "user") {
    const me = String(req.user.id);
    for (const item of draft?.items || []) {
      for (const s of item?.stages || []) {
        if (s?.assignedUser && String(s.assignedUser) === me) return true;
      }
    }
  }

  return false;
};

const getInternalCalendar = async (req, res) => {
  try {
    const { clientId } = req.params;
    if (!clientId) return failure(res, "clientId is required", 400);

    const draft = await ClientScheduleDraft.findOne({ clientId })
      .populate("items.contentId", "title type contentType")
      .populate("items.stages.assignedUser", "name avatar")
      .lean();
    if (!draft) return failure(res, "Schedule draft not found", 404);

    const allowed = await canAccessDraft(req, clientId, draft);
    if (!allowed) return failure(res, "Forbidden", 403);

    const payload = {
      clientId: draft.clientId,
      items: (draft.items || []).map((item) => ({
        contentId: item.contentId?._id || item.contentId,
        title: item.contentId?.title || "",
        type: item.type,
        stages: (item.stages || []).map((s) => ({
          name: s.name,
          role: s.role,
          assignedUser: s.assignedUser || null,
          date: toYMD(s.date),
          status: s.status,
        })),
        postingDate: toYMD(item.postingDate),
        isLocked: Boolean(item.isLocked),
      })),
    };

    return success(res, payload);
  } catch (err) {
    return failure(res, err.message || "Failed to fetch internal calendar", 500);
  }
};

const updateInternalCalendarStage = async (req, res) => {
  try {
    const { contentId, stageName, newDate } = req.body || {};
    if (!contentId || !stageName || !newDate) {
      return failure(res, "contentId, stageName and newDate are required", 400);
    }
    if (!USER_EDITABLE_STAGES.has(String(stageName))) {
      return failure(
        res,
        "Only Plan, Shoot, Edit, Approval stages can be updated",
        400
      );
    }

    const draft = await ClientScheduleDraft.findOne({ "items.contentId": contentId });
    if (!draft) return failure(res, "Schedule draft not found", 404);

    const allowed = await canAccessDraft(req, draft.clientId, draft);
    if (!allowed) return failure(res, "Forbidden", 403);

    const item = (draft.items || []).find(
      (it) => it?.contentId && String(it.contentId) === String(contentId)
    );
    if (!item) return failure(res, "Draft item not found", 404);

    const stages = item.stages || [];
    const stageIndex = stages.findIndex((s) => String(s?.name) === String(stageName));
    if (stageIndex === -1) return failure(res, "Stage not found for this content item", 404);
    if (String(stages[stageIndex]?.name) === "Post") {
      return failure(res, "Posting date is locked", 400);
    }

    const requested = normalizeUTCDate(newDate);
    if (!requested) return failure(res, "newDate must be a valid date", 400);

    const targetStage = stages[stageIndex];
    const oldTargetDate = normalizeUTCDate(targetStage?.date);
    const assignedUser = targetStage?.assignedUser;
    if (!assignedUser) return failure(res, "Stage has no assigned user", 400);

    // Prompt 80: urgent reels get a slight priority boost.
    const contentItemForPlan = await ContentItem.findById(contentId)
      .select("planType")
      .lean();
    const planType = String(contentItemForPlan?.planType || "normal").toLowerCase();
    const capacityDelta = planType === "urgent" ? 1 : 0;

    const resolvedTargetDate = normalizeUTCDate(
      await getNextAvailableDate(
        targetStage.role,
        assignedUser,
        requested,
        { capacityDelta }
      )
    );
    // Prompt 74: manual drag/edit must not overload capacity.
    // If requested date is not immediately available, reject instead of auto-pushing.
    if (!isSameUTCDate(resolvedTargetDate, requested)) {
      const suggestions = await suggestNextAvailableSlots(
        targetStage.role,
        assignedUser,
        requested,
        { capacityDelta }
      );
      return res.status(200).json({
        success: false,
        message: "Capacity exceeded",
        suggestions,
      });
    }
    targetStage.date = resolvedTargetDate;
    const deltaMs = oldTargetDate ? resolvedTargetDate.getTime() - oldTargetDate.getTime() : 0;

    // Prompt 70/71: after update, shift NEXT editable stages only.
    // Post stage and item.postingDate stay unchanged (locked client commitment).
    for (let i = stageIndex + 1; i < stages.length; i++) {
      const s = stages[i];
      if (!USER_EDITABLE_STAGES.has(String(s?.name))) break;
      if (!s?.assignedUser) continue;
      const oldNextDate = normalizeUTCDate(s.date) || addDaysUTC(resolvedTargetDate, i - stageIndex);
      const shiftedByDelta = normalizeUTCDate(addDaysUTC(oldNextDate, Math.round(deltaMs / 86400000)));
      const next = normalizeUTCDate(
        await getNextAvailableDate(s.role, s.assignedUser, shiftedByDelta, {
          capacityDelta,
        })
      );
      s.date = next;
    }

    // Prompt 79: keep post locked, but enforce dependency sanity against locked posting date.
    const approvalStage = stages.find((s) => String(s?.name) === "Approval");
    const postingDate = normalizeUTCDate(item.postingDate);
    if (approvalStage?.date && postingDate) {
      const approvalDate = normalizeUTCDate(approvalStage.date);
      if (approvalDate && approvalDate.getTime() >= postingDate.getTime()) {
        return failure(
          res,
          "Selected date conflicts with locked posting date",
          400
        );
      }
    }

    // Prompt 72: keep ContentItem workflow stage dates in sync with the draft.
    // Only stage due dates are updated; posting date (clientPostingDate) is never changed.
    const contentItem = await ContentItem.findById(contentId);
    if (!contentItem) return failure(res, "Content item not found", 404);

    const stageDateByName = new Map(
      (item.stages || []).map((s) => [String(s.name), normalizeUTCDate(s.date)])
    );
    contentItem.workflowStages = (contentItem.workflowStages || []).map((ws) => {
      const key = String(ws.stageName || "");
      if (USER_EDITABLE_STAGES.has(key) && stageDateByName.has(key)) {
        ws.dueDate = stageDateByName.get(key);
      }
      return ws;
    });
    await contentItem.save();

    await draft.save();

    const updatedItem = {
      contentId: item.contentId,
      type: item.type,
      stages: (item.stages || []).map((s) => ({
        name: s.name,
        role: s.role,
        assignedUser: s.assignedUser,
        date: toYMD(s.date),
        status: s.status,
      })),
      postingDate: toYMD(item.postingDate),
      isLocked: Boolean(item.isLocked),
    };

    return res.status(200).json({ success: true });
  } catch (err) {
    return failure(res, err.message || "Failed to update internal calendar", 500);
  }
};

module.exports = {
  getInternalCalendar,
  updateInternalCalendarStage,
};

