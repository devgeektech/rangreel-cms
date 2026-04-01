const User = require("../models/User");
const ContentItem = require("../models/ContentItem");
const Role = require("../models/Role");

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
      workflowStages: {
        $elemMatch: {
          assignedUser: req.user.id,
          status: { $in: ["assigned", "in_progress"] },
        },
      },
    })
      .populate("client", "brandName clientName")
      .select("title contentType plan clientPostingDate overallStatus workflowStages client")
      .lean();

    const tasks = items.map((item) => {
      const filteredStages = (item.workflowStages || []).filter((s) => {
        const isMine = s.assignedUser && String(s.assignedUser) === String(req.user.id);
        const stageStatus = String(s.status || "").toLowerCase();
        const isActive = stageStatus === "assigned" || stageStatus === "in_progress";
        return isMine && isActive;
      });

      const approvalStage = (item.workflowStages || []).find((s) => {
        const n = String(s?.stageName || "").toLowerCase();
        return n === "approval" || n === "approve";
      });

      return {
        contentItemId: item._id,
        title: item.title,
        contentType: item.contentType,
        plan: item.plan,
        clientPostingDate: toYMD(item.clientPostingDate),
        clientBrandName: item.client?.brandName || "",
        approvalStatus: approvalStage?.status || "",
        stages: filteredStages.map((s) => ({
          ...s,
          dueDate: toYMD(s.dueDate),
          completedAt: toYMD(s.completedAt),
        })),
        overallStatus: item.overallStatus,
      };
    });

    console.log("[getMyTasks] returned tasks", {
      userId: String(req.user.id),
      month,
      count: tasks.length,
      taskTitles: tasks.map((t) => t.title),
    });

    return success(res, tasks);
  } catch (error) {
    return failure(res, error.message || "Failed to fetch tasks", 500);
  }
};

const updateMyTaskStatus = async (req, res) => {
  try {
    const { itemId, stageId } = req.params;
    const body = req.body || {};
    const { status: requestedStatus } = body;

    // Only worker roles update via this endpoint. Managers approve/reject via manager routes.
    if (req.user?.roleType !== "user") {
      return failure(res, "Only user roles can update stage status", 403);
    }

    const me = await User.findById(req.user.id).select("role roleType isActive").lean();
    if (!me || me.isActive === false) {
      return failure(res, "User not found", 404);
    }
    const roleDoc = me.role
      ? await Role.findById(me.role).select("slug name").lean()
      : null;

    const canonicalRoleKey = (raw) => {
      const key = String(raw || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      if (!key) return "";

      // Common slug->stage-role aliases.
      if (key === "editor") return "videoeditor";
      if (key === "videoeditor") return "videoeditor";
      if (key === "posting") return "postingexecutive";
      if (key === "postingexecutive") return "postingexecutive";
      if (key === "designer") return "graphicdesigner";
      if (key === "graphicdesigner") return "graphicdesigner";

      return key;
    };

    const myRoleKey = canonicalRoleKey(roleDoc?.slug || roleDoc?.name);

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

    // Prompt 30: role must match stage role.
    const stageRoleKey = canonicalRoleKey(stage.role);
    if (!myRoleKey || !stageRoleKey || myRoleKey !== stageRoleKey) {
      return failure(res, "Forbidden: role does not match stage role", 403);
    }

    const currentStatus = stage.status;
    const stageNameNormalized = String(stage.stageName || "").toLowerCase();

    // Prompt 18 lifecycle:
    // assigned -> in_progress -> completed
    // (accept "planned" as legacy alias of "assigned" for backward compatibility)
    const effectiveCurrentStatus =
      currentStatus === "planned" ? "assigned" : currentStatus;
    const inferredNextStatus =
      effectiveCurrentStatus === "assigned"
        ? "in_progress"
        : effectiveCurrentStatus === "in_progress"
        ? "completed"
        : null;

    const nextStatus = requestedStatus || inferredNextStatus;
    if (!nextStatus) return failure(res, "Stage status transition is not allowed", 400);

    const allowed =
      (effectiveCurrentStatus === "assigned" && nextStatus === "in_progress") ||
      (effectiveCurrentStatus === "in_progress" && nextStatus === "completed");

    if (!allowed) return failure(res, "Stage status transition is not allowed", 400);

    stage.status = nextStatus;
    if (nextStatus === "completed") {
      stage.completedAt = new Date();
      const n = stageNameNormalized;
      if (n === "plan") {
        if (body.hook !== undefined) stage.hook = String(body.hook || "").trim();
        if (body.concept !== undefined) stage.concept = String(body.concept || "").trim();
        if (body.captionDirection !== undefined)
          stage.captionDirection = String(body.captionDirection || "").trim();
        if (body.contentBrief !== undefined) {
          if (!Array.isArray(body.contentBrief)) {
            return failure(res, "contentBrief must be an array of strings", 400);
          }
          const cleaned = body.contentBrief
            .map((x) => String(x || "").trim())
            .filter((x) => x.length > 0);
          stage.contentBrief = cleaned;
        }
      }
      if (n === "shoot" && body.footageLink !== undefined)
        stage.footageLink = String(body.footageLink || "").trim();
      if (n === "edit") {
        if (body.editedFileLink !== undefined)
          stage.editedFileLink = String(body.editedFileLink || "").trim();
        if (body.videoUrl !== undefined) {
          contentItem.videoUrl = String(body.videoUrl || "").trim();
        }
      }
      if (n === "work" && body.designFileLink !== undefined)
        stage.designFileLink = String(body.designFileLink || "").trim();
      if (n === "post") {
        contentItem.overallStatus = "posted";
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

const getTeamClient = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return failure(res, "Client id is required", 400);

    const assigned = await ContentItem.exists({
      client: id,
      "workflowStages.assignedUser": req.user.id,
    });
    if (!assigned && req.user?.roleType !== "admin" && req.user?.roleType !== "manager") {
      return failure(res, "Forbidden", 403);
    }

    const items = await ContentItem.find({ client: id })
      .select("title type contentType clientPostingDate workflowStages")
      .sort({ clientPostingDate: 1 })
      .lean();

    return success(res, {
      clientId: id,
      contentItems: (items || []).map((item) => ({
        _id: item._id,
        title: item.title,
        type: item.type,
        contentType: item.contentType,
        postingDate: toYMD(item.clientPostingDate),
        stages: (item.workflowStages || []).map((s) => ({
          stageName: s.stageName,
          dueDate: toYMD(s.dueDate),
          role: s.role,
          status: s.status,
          assignedUser: s.assignedUser || null,
        })),
      })),
    });
  } catch (error) {
    return failure(res, error.message || "Failed to fetch client", 500);
  }
};

module.exports = {
  getMe,
  getMyTasks,
  updateMyTaskStatus,
  getTeamClient,
};
