const ContentItem = require("../models/ContentItem");
const PublicHoliday = require("../models/PublicHoliday");
const Client = require("../models/Client");

const success = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

const failure = (res, error, statusCode = 400) =>
  res.status(statusCode).json({ success: false, error });

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

    const holidayDayEnd = addDaysUTC(normalizedDueDate, 1);
    const holidayExists = await PublicHoliday.exists({
      date: { $gte: normalizedDueDate, $lt: holidayDayEnd },
    });
    if (holidayExists) {
      return failure(res, "Due date cannot be on a public holiday", 400);
    }

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

    // Manager can only approve/reject stages within their own clients.
    const client = await Client.findOne({ _id: contentItem.client, manager: req.user.id }).select("_id");
    if (!client) {
      return failure(res, "Client not found or access denied", 403);
    }

    // Apply status + notes.
    if (status === "approved") {
      stage.status = "approved";
      stage.rejectionNote = "";
    }

    if (status === "rejected") {
      stage.status = "rejected";
      stage.rejectionNote = String(rejectionNote || "").trim();

      // Revert to the nearest previous non-approval stage so rejecting either
      // Approval stage always routes back to the editor/designer, not back to approval.
      let targetStageIndex = stageIndex - 1;
      while (targetStageIndex >= 0) {
        const candidate = contentItem.workflowStages[targetStageIndex];
        const candidateName = String(candidate?.stageName || "").toLowerCase();
        const candidateIsApproval =
          candidateName === "approval" || candidateName === "approve";

        if (!candidateIsApproval) break;
        targetStageIndex -= 1;
      }

      const targetStage = contentItem.workflowStages[targetStageIndex];
      if (!targetStage) {
        return failure(res, "Cannot reject without a valid editor/designer stage", 400);
      }

      // Revert target stage back to in_progress.
      targetStage.status = "in_progress";
      targetStage.completedAt = undefined;
      targetStage.rejectionNote = "";

      // Update overall status to match the stage we're routing back to.
      const targetName = String(targetStage.stageName || "").toLowerCase();
      if (targetName === "edit") {
        contentItem.overallStatus = "editing";
      } else if (targetName === "work") {
        contentItem.overallStatus = "working";
      }
    }

    // If this is the approval stage and manager approves it, move item to scheduled.
    const stageNameNormalized = String(stage.stageName || "").toLowerCase();
    const isApproveStage =
      stageNameNormalized === "approval" || stageNameNormalized === "approve";

    if (status === "approved" && isApproveStage) {
      contentItem.overallStatus = "scheduled";
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
  reshuffleStage,
  updateStageStatus,
};

