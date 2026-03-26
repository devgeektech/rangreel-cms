const User = require("../models/User");
const ContentItem = require("../models/ContentItem");

const success = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

const failure = (res, error, statusCode = 400) =>
  res.status(statusCode).json({ success: false, error });

const normalizeMonthTarget = (targetMonth) => {
  if (!targetMonth) return null;
  const m = String(targetMonth).match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]); // 1-12
  if (Number.isNaN(year) || Number.isNaN(month) || month < 1 || month > 12)
    return null;
  return { year, month };
};

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate("role");

    if (!user || !user.isActive) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    return res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Failed to fetch user" });
  }
};

const getMyTasks = async (req, res) => {
  try {
    const month = req.query.month;

    if (!normalizeMonthTarget(month)) {
      return failure(res, "month must be in format YYYY-MM", 400);
    }

    const items = await ContentItem.find({
      month,
      "workflowStages.assignedUser": req.user.id,
    })
      .populate("client", "brandName clientName")
      .select("title contentType plan clientPostingDate overallStatus workflowStages client")
      .lean();

    const tasks = items.map((item) => {
      const filteredStages = (item.workflowStages || []).filter(
        (s) => s.assignedUser && String(s.assignedUser) === String(req.user.id)
      );

      return {
        contentItemId: item._id,
        title: item.title,
        contentType: item.contentType,
        plan: item.plan,
        clientPostingDate: item.clientPostingDate,
        clientBrandName: item.client?.brandName || "",
        stages: filteredStages,
        overallStatus: item.overallStatus,
      };
    });

    return success(res, tasks);
  } catch (error) {
    return failure(res, error.message || "Failed to fetch tasks", 500);
  }
};

const updateMyTaskStatus = async (req, res) => {
  try {
    const { itemId, stageId } = req.params;
    const { status: requestedStatus } = req.body || {};

    const contentItem = await ContentItem.findById(itemId);
    if (!contentItem) return failure(res, "ContentItem not found", 404);

    const stageIndex = (contentItem.workflowStages || []).findIndex(
      (s) => s._id && s._id.toString() === String(stageId)
    );
    if (stageIndex === -1) return failure(res, "Stage not found", 404);

    const stage = contentItem.workflowStages[stageIndex];

    const assignedUserId = stage.assignedUser ? stage.assignedUser.toString() : null;
    if (!assignedUserId || assignedUserId !== req.user.id) {
      return failure(res, "You are not assigned to this stage", 403);
    }

    const currentStatus = stage.status;
    const stageNameNormalized = String(stage.stageName || "").toLowerCase();

    // Posting Executive: allow Post stage -> posted and update overallStatus.
    if (requestedStatus === "posted") {
      if (stageNameNormalized !== "post") {
        return failure(res, 'Only "Post" stages can be marked as posted', 400);
      }

      stage.status = "posted";
      stage.completedAt = new Date();
      contentItem.overallStatus = "posted";
      await contentItem.save();

      return success(res, {
        itemId: contentItem._id,
        stage,
        overallStatus: contentItem.overallStatus,
      });
    }

    // Default transitions for other stages:
    const inferredNextStatus =
      currentStatus === "planned"
        ? "in_progress"
        : currentStatus === "in_progress"
        ? "submitted"
        : null;

    const nextStatus = requestedStatus || inferredNextStatus;
    if (!nextStatus) return failure(res, "Stage status transition is not allowed", 400);

    const allowed =
      (currentStatus === "planned" && nextStatus === "in_progress") ||
      (currentStatus === "in_progress" && nextStatus === "submitted");

    if (!allowed) return failure(res, "Stage status transition is not allowed", 400);

    stage.status = nextStatus;
    if (nextStatus === "submitted") {
      stage.completedAt = new Date();
      const n = stageNameNormalized;
      if (n === "plan") {
        if (body.hook !== undefined) stage.hook = String(body.hook || "").trim();
        if (body.concept !== undefined) stage.concept = String(body.concept || "").trim();
        if (body.captionDirection !== undefined)
          stage.captionDirection = String(body.captionDirection || "").trim();
      }
      if (n === "shoot" && body.footageLink !== undefined)
        stage.footageLink = String(body.footageLink || "").trim();
      if (n === "edit" && body.editedFileLink !== undefined)
        stage.editedFileLink = String(body.editedFileLink || "").trim();
      if (n === "work" && body.designFileLink !== undefined)
        stage.designFileLink = String(body.designFileLink || "").trim();
    }

    // Workflow loop support:
    // If the editor/designer submits again after a manager rejection, any
    // subsequent approval stages that were previously rejected should become pending again.
    if (nextStatus === "submitted" && (stageNameNormalized === "edit" || stageNameNormalized === "work")) {
      for (let i = stageIndex + 1; i < (contentItem.workflowStages || []).length; i++) {
        const s = contentItem.workflowStages[i];
        const sName = String(s?.stageName || "").toLowerCase();
        const sStatus = String(s?.status || "").toLowerCase();
        const isApprovalStage = sName === "approval" || sName === "approve";
        if (!isApprovalStage) continue;
        if (sStatus !== "rejected") continue;

        // Reset rejected approvals to pending.
        s.status = "planned";
        s.rejectionNote = "";
        s.completedAt = undefined;
      }
    }

    await contentItem.save();

    return success(res, {
      itemId: contentItem._id,
      stage,
    });
  } catch (error) {
    return failure(res, error.message || "Failed to update task status", 500);
  }
};

module.exports = {
  getMe,
  getMyTasks,
  updateMyTaskStatus,
};
