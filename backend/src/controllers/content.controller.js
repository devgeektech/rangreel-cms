const ContentItem = require("../models/ContentItem");
// const PublicHoliday = require("../models/PublicHoliday"); // Prompt 20 safe cleanup: keep model, stop using in runtime flow.
const Client = require("../models/Client");

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

const normalizeUtcMidnight = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

const isWeekendUTC = (d) => {
  const day = d.getUTCDay(); // 0=Sun, 6=Sat
  return day === 0 || day === 6;
};

const addDaysUTC = (d, days) => {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const canReadContentItem = async (req, contentItem) => {
  // Prompt 30: all authenticated roles can VIEW reel details.
  // Manager/admin remain allowed; we don't restrict viewing to assignment.
  return Boolean(req.user && req.user.id);
};

const getContentById = async (req, res) => {
  try {
    const { id } = req.params;

    const item = await ContentItem.findById(id)
      .populate("workflowStages.assignedUser", "name avatar")
      .lean();

    if (!item) return failure(res, "ContentItem not found", 404);

    const allowed = await canReadContentItem(req, item);
    if (!allowed) return failure(res, "Forbidden", 403);

    const planStage = (item.workflowStages || []).find(
      (s) => String(s?.stageName || "").toLowerCase() === "plan"
    );

    return success(res, {
      title: item.title,
      planType: item.planType || item.plan || "normal",
      contentBrief: Array.isArray(planStage?.contentBrief) ? planStage.contentBrief : [],
      videoUrl: item.videoUrl || "",
      stages: (item.workflowStages || []).map((s) => ({
        _id: s._id,
        stageName: s.stageName,
        role: s.role,
        status: s.status,
        dueDate: toYMD(s.dueDate),
        completedAt: toYMD(s.completedAt),
        rejectionNote: s.rejectionNote,
        assignedUser: s.assignedUser || null,
      })),
    });
  } catch (err) {
    return failure(res, err.message || "Failed to fetch content item", 500);
  }
};

const getStageIndexById = (stages, stageId) => {
  if (!stageId) return -1;
  return stages.findIndex((s) => s._id && s._id.toString() === String(stageId));
};

const reshuffleStage = async (req, res) => {
  try {
    const { itemId, stageId } = req.params;
    const { newDueDate } = req.body || {};

    const normalizedDueDate = normalizeUtcMidnight(newDueDate);
    if (!normalizedDueDate) {
      return failure(res, "newDueDate must be a valid date", 400);
    }

    if (isWeekendUTC(normalizedDueDate)) {
      return failure(res, "Due date cannot be on a weekend", 400);
    }

    // Prompt 20 safe cleanup:
    // Public holiday validation is intentionally disabled for now.
    // const holidayDayEnd = addDaysUTC(normalizedDueDate, 1);
    // const holidayExists = await PublicHoliday.exists({
    //   date: { $gte: normalizedDueDate, $lt: holidayDayEnd },
    // });
    // if (holidayExists) {
    //   return failure(res, "Due date cannot be on a public holiday", 400);
    // }

    const contentItem = await ContentItem.findById(itemId);
    if (!contentItem) return failure(res, "ContentItem not found", 404);

    const stageIndex = getStageIndexById(contentItem.workflowStages, stageId);
    if (stageIndex === -1) return failure(res, "Stage not found", 404);

    // Manager reshuffle must be constrained by client ownership.
    const client = await Client.findOne({
      _id: contentItem.client,
      manager: req.user.id,
    }).select("startDate endDate");
    if (!client) {
      return failure(res, "Client not found or access denied", 403);
    }

    const clientStart = normalizeUtcMidnight(client.startDate);
    const clientEnd = normalizeUtcMidnight(client.endDate);
    if (!clientStart || !clientEnd) {
      return failure(res, "Client date range is invalid", 400);
    }

    if (normalizedDueDate.getTime() < clientStart.getTime() || normalizedDueDate.getTime() > clientEnd.getTime()) {
      return failure(res, "Due date must be within the client's start/end date range", 400);
    }

    const prevStage = contentItem.workflowStages[stageIndex - 1] || null;
    const nextStage = contentItem.workflowStages[stageIndex + 1] || null;

    if (prevStage?.dueDate) {
      const prevDue = normalizeUtcMidnight(prevStage.dueDate);
      if (!prevDue) return failure(res, "Previous stage dueDate is invalid", 400);
      if (normalizedDueDate.getTime() <= prevDue.getTime()) {
        return failure(res, "Due date must be strictly after the previous stage due date", 400);
      }
    }

    if (nextStage?.dueDate) {
      const nextDue = normalizeUtcMidnight(nextStage.dueDate);
      if (!nextDue) return failure(res, "Next stage dueDate is invalid", 400);
      if (normalizedDueDate.getTime() >= nextDue.getTime()) {
        return failure(res, "Due date must be strictly before the next stage due date", 400);
      }
    }

    // Update only stage.dueDate. Never touch clientPostingDate.
    contentItem.workflowStages[stageIndex].dueDate = normalizedDueDate;
    await contentItem.save();

    return success(res, {
      itemId: contentItem._id,
      stage: contentItem.workflowStages[stageIndex],
    });
  } catch (err) {
    return failure(res, err.message || "Failed to reshuffle stage", 500);
  }
};

const updateStageStatus = async (req, res) => {
  try {
    const { itemId, stageId } = req.params;
    const { status, rejectionNote } = req.body || {};

    if (status !== "approved" && status !== "rejected") {
      return failure(res, 'status must be either "approved" or "rejected"', 400);
    }

    const contentItem = await ContentItem.findById(itemId);
    if (!contentItem) return failure(res, "ContentItem not found", 404);

    const stageIndex = getStageIndexById(contentItem.workflowStages, stageId);
    if (stageIndex === -1) return failure(res, "Stage not found", 404);

    const stage = contentItem.workflowStages[stageIndex];
    const stageNameNormalized = String(stage.stageName || "").toLowerCase();
    const isApproveStage =
      stageNameNormalized === "approval" || stageNameNormalized === "approve";

    // Manager can only approve/reject stages within their own clients.
    const client = await Client.findOne({ _id: contentItem.client, manager: req.user.id }).select("_id");
    if (!client) {
      return failure(res, "Client not found or access denied", 403);
    }

    if (!isApproveStage) {
      return failure(res, "Only approval stages can be approved or rejected", 400);
    }

    // Prompt 28: manager approves/rejects based on Edit stage completion (not Approval stage completion).
    let editStageIndex = -1;
    for (let i = stageIndex - 1; i >= 0; i--) {
      const candidateName = String(contentItem.workflowStages[i]?.stageName || "").toLowerCase();
      if (candidateName === "edit") {
        editStageIndex = i;
        break;
      }
    }
    if (editStageIndex === -1) {
      return failure(res, "Cannot approve/reject without a previous Edit stage", 400);
    }

    const editStage = contentItem.workflowStages[editStageIndex];
    if (String(editStage.status || "").toLowerCase() !== "completed") {
      return failure(res, "Edit stage must be completed before approval", 400);
    }

    if (status === "approved") {
      const approvalBefore = String(stage.status || "").toLowerCase();
      stage.status = "approved";
      stage.rejectionNote = "";
      stage.completedAt = new Date();
      // Prompt 28: approving unlocks Post stage.
      const postStage = (contentItem.workflowStages || []).find(
        (s) => String(s?.stageName || "").toLowerCase() === "post"
      );
      if (postStage) {
        const postBefore = String(postStage.status || "").toLowerCase();
        console.log("[approve] before", {
          itemId: String(contentItem._id),
          approvalStageStatus: approvalBefore,
          postStageStatus: postBefore,
        });

        // Prompt 31: approval MUST activate Post stage.
        // IMPORTANT: do NOT downgrade a completed/posted Post stage.
        const isAlreadyPosted = postBefore === "completed" || postBefore === "posted";
        const isInactivePost =
          postBefore === "planned" ||
          postBefore === "pending" ||
          postBefore === "locked" ||
          postBefore === "assigned";

        if (!isAlreadyPosted) {
          // Even if unexpected status, we force activation to assigned.
          postStage.status = "assigned";
          postStage.completedAt = undefined;
          postStage.rejectionNote = "";
        }

        console.log("[approve] after", {
          itemId: String(contentItem._id),
          approvalStageStatus: String(stage.status || "").toLowerCase(),
          postStageStatus: String(postStage.status || "").toLowerCase(),
          wasInactivePostStatus: isInactivePost,
          alreadyPosted: isAlreadyPosted,
        });
      }

      contentItem.overallStatus = "scheduled";
    }

    if (status === "rejected") {
      stage.status = "rejected";
      const note = String(rejectionNote || "").trim();
      stage.rejectionNote = note;
      stage.completedAt = new Date();

      // Simple rejection path: move previous Edit stage back to in_progress.
      editStage.status = "in_progress";
      editStage.completedAt = undefined;
      editStage.rejectionNote = note;
      contentItem.overallStatus = "editing";

      // While rejected, Post must not be actionable.
      const postStage = (contentItem.workflowStages || []).find(
        (s) => String(s?.stageName || "").toLowerCase() === "post"
      );
      if (postStage) {
        postStage.status = "planned";
        postStage.completedAt = undefined;
      }
    }

    // Save updates.
    await contentItem.save();

    return success(res, {
      itemId: contentItem._id,
      stage,
      overallStatus: contentItem.overallStatus,
    });
  } catch (err) {
    return failure(res, err.message || "Failed to update stage status", 500);
  }
};

module.exports = {
  getContentById,
  reshuffleStage,
  updateStageStatus,
};

