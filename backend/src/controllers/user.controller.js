const User = require("../models/User");
const ContentItem = require("../models/ContentItem");
const Notification = require("../models/Notification");
const Role = require("../models/Role");
const Client = require("../models/Client");
const Leave = require("../models/Leave");
const TeamCapacity = require("../models/TeamCapacity");
const UserCapacity = require("../models/UserCapacity");
const managerReadController = require("./managerRead.controller");
const { runManagerDragTask } = require("../services/managerDragTask.service");
const { notifyUsers } = require("../services/workflowNotification.service");
const { resolveDisplayIdForRead } = require("../utils/taskDisplayId.util");

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

const normalizeContentBucket = (contentType) => {
  const t = String(contentType || "").toLowerCase();
  if (t === "reel") return "reel";
  if (t === "carousel") return "carousel";
  return "post";
};

const getRoleCapacityForBucket = (capacityDoc, bucket) => {
  if (!capacityDoc) return 0;
  if (bucket === "reel") return Number(capacityDoc.reelCapacity) || 0;
  if (bucket === "carousel") return Number(capacityDoc.carouselCapacity) || 0;
  return Number(capacityDoc.postCapacity) || 0;
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
    const includeCompleted =
      String(req.query.includeCompleted || "").toLowerCase() === "true" ||
      req.query.includeCompleted === "1";

    if (!normalizeMonthTarget(month)) {
      return failure(res, "month must be in format YYYY-MM", 400);
    }

    const normalizedMonth = normalizeMonthTarget(month);
    const year = Number(normalizedMonth.year);
    const monthIndex = Number(normalizedMonth.month) - 1;
    const monthStart = new Date(Date.UTC(year, monthIndex, 1));
    const monthEndExclusive = new Date(Date.UTC(year, monthIndex + 1, 1));

    const statusInQuery = includeCompleted
      ? ["assigned", "in_progress", "planned", "completed"]
      : ["assigned", "in_progress", "planned"];

    const items = await ContentItem.find({
      workflowStages: {
        $elemMatch: {
          assignedUser: req.user.id,
          status: { $in: statusInQuery },
        },
      },
    })
      .populate("client", "brandName clientName")
      .select("title displayId taskType taskNumber contentType plan clientPostingDate overallStatus workflowStages client")
      .lean();

    const tasks = items
      .map((item) => {
      const filteredStages = (item.workflowStages || []).filter((s) => {
        const isMine = s.assignedUser && String(s.assignedUser) === String(req.user.id);
        const stageStatus = String(s.status || "").toLowerCase();
        const due = s?.dueDate ? new Date(s.dueDate) : null;
        const inMonth =
          due instanceof Date &&
          !Number.isNaN(due.getTime()) &&
          due.getTime() >= monthStart.getTime() &&
          due.getTime() < monthEndExclusive.getTime();
        const allowedPending =
          stageStatus === "assigned" ||
          stageStatus === "in_progress" ||
          stageStatus === "planned";
        const isIncluded = includeCompleted
          ? allowedPending || stageStatus === "completed"
          : allowedPending;
        return isMine && inMonth && isIncluded;
      });

      const approvalStage = (item.workflowStages || []).find((s) => {
        const n = String(s?.stageName || "").toLowerCase();
        return n === "approval" || n === "approve";
      });

      return {
        contentItemId: item._id,
        title: item.title,
        displayId: resolveDisplayIdForRead(item),
        taskType: item.taskType || "",
        taskNumber: item.taskNumber || null,
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
    })
      .filter((t) => (t.stages || []).length > 0);

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

    const client = await Client.findById(contentItem.client).select("brandName clientName manager team").lean();
    const titleText = contentItem?.title || "Content item";
    const ctBucket = normalizeContentBucket(contentItem?.contentType || contentItem?.type);

    if (nextStatus === "completed") {
      const n = stageNameNormalized;
      if (n === "plan") {
        const target = client?.team?.reels?.videographer;
        await notifyUsers({
          userIds: target ? [target] : [],
          title: "Task Handoff",
          message: `${titleText} ready for shoot`,
          type: "task",
          contentId: contentItem._id,
        });
      } else if (n === "shoot") {
        const target = client?.team?.reels?.videoEditor;
        await notifyUsers({
          userIds: target ? [target] : [],
          title: "Task Handoff",
          message: `${titleText} ready for editing`,
          type: "task",
          contentId: contentItem._id,
        });
      } else if (n === "edit") {
        const target = client?.manager;
        await notifyUsers({
          userIds: target ? [target] : [],
          title: "Approval Ready",
          message: `${titleText} ready for approval`,
          type: "approval",
          contentId: contentItem._id,
        });
      } else if (n === "post") {
        const strategistIds = [
          client?.team?.reels?.strategist,
          client?.team?.posts?.strategist,
          client?.team?.carousel?.strategist,
        ]
          .filter(Boolean)
          .map((id) => String(id));
        await notifyUsers({
          userIds: [client?.manager, ...strategistIds],
          title: "Post Completed",
          message: `${titleText} has been posted successfully`,
          type: "completion",
          contentId: contentItem._id,
        });
      }
    }

    // Case 10: overload alert.
    if (stage?.assignedUser && stage?.dueDate) {
      const roleKey = canonicalRoleKey(stage.role);
      const dayStart = new Date(new Date(stage.dueDate).setUTCHours(0, 0, 0, 0));
      const dayEnd = new Date(new Date(stage.dueDate).setUTCHours(23, 59, 59, 999));
      const capDoc = await TeamCapacity.findOne({ role: roleKey }).lean();
      const capacity = getRoleCapacityForBucket(capDoc, ctBucket);
      if (capacity > 0) {
        const count = await ContentItem.countDocuments({
          "workflowStages.assignedUser": stage.assignedUser,
          contentType:
            ctBucket === "post" ? { $in: ["post", "static_post", "gmb_post", "campaign"] } : ctBucket,
          workflowStages: {
            $elemMatch: {
              assignedUser: stage.assignedUser,
              dueDate: { $gte: dayStart, $lte: dayEnd },
              status: { $nin: ["completed", "approved", "posted"] },
            },
          },
        });
        if (count > capacity) {
          const strategistIds = [
            client?.team?.reels?.strategist,
            client?.team?.posts?.strategist,
            client?.team?.carousel?.strategist,
          ]
            .filter(Boolean)
            .map((id) => String(id));
          await notifyUsers({
            userIds: [stage.assignedUser, client?.manager, ...strategistIds],
            title: "Overload Alert",
            message: "User is overloaded with tasks",
            type: "overload",
            contentId: contentItem._id,
          });
        }
      }
    }

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
      .select("title displayId taskType taskNumber type contentType clientPostingDate workflowStages")
      .sort({ clientPostingDate: 1 })
      .lean();

    return success(res, {
      clientId: id,
      contentItems: (items || []).map((item) => ({
        _id: item._id,
        title: item.title,
        displayId: resolveDisplayIdForRead(item),
        taskType: item.taskType || "",
        taskNumber: item.taskNumber || null,
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

const getUserRoleSlug = async (userId) => {
  const me = await User.findById(userId).populate("role", "slug").select("role roleType").lean();
  return String(me?.role?.slug || "").toLowerCase();
};

const getStrategistAssignedClientIds = async (userId) => {
  const docs = await Client.find({
    $or: [
      { "team.reels.strategist": userId },
      { "team.posts.strategist": userId },
      { "team.carousel.strategist": userId },
    ],
  })
    .select("_id")
    .lean();
  return (docs || []).map((d) => String(d._id));
};

const ensureStrategistUser = async (req) => {
  const dashboardRoute = String(req.user?.dashboardRoute || "").toLowerCase();
  if (dashboardRoute.startsWith("/strategist")) return true;
  const roleSlug = await getUserRoleSlug(req.user.id);
  return roleSlug === "strategist";
};

const getStrategistGlobalCalendar = async (req, res) => {
  const ok = await ensureStrategistUser(req);
  if (!ok) return failure(res, "Only strategist can access this endpoint", 403);
  return managerReadController.getManagerGlobalCalendarFinal(req, res);
};

const getMyNotifications = async (req, res) => {
  try {
    const docs = await Notification.find({ user: req.user.id })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    return success(res, docs);
  } catch (error) {
    return failure(res, error.message || "Failed to fetch notifications", 500);
  }
};

const markNotificationRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const updated = await Notification.findOneAndUpdate(
      { _id: notificationId, user: req.user.id },
      { $set: { isRead: true } },
      { new: true }
    ).lean();
    if (!updated) return failure(res, "Notification not found", 404);
    return success(res, updated);
  } catch (error) {
    return failure(res, error.message || "Failed to update notification", 500);
  }
};

const getStrategistTeamUsers = async (req, res) => {
  try {
    const ok = await ensureStrategistUser(req);
    if (!ok) return failure(res, "Only strategist can access this endpoint", 403);
    const users = await User.find({ roleType: "user" }).populate("role").sort({ createdAt: -1 }).lean();
    const managers = await User.find({ roleType: "manager" }).populate("role").sort({ createdAt: -1 }).lean();
    const filteredUsers = users.filter((u) => u.role && !u.role.isSystem);
    const normalizedManagers = managers.map((m) => {
      const roleObj =
        m?.role && typeof m.role === "object"
          ? { ...m.role, name: m.role.name || "manager", slug: m.role.slug || "manager" }
          : { name: "manager", slug: "manager" };
      return { ...m, role: roleObj };
    });
    const allRows = [...filteredUsers, ...normalizedManagers];
    const allUserIds = allRows.map((r) => r?._id).filter(Boolean);
    const capDocs = allUserIds.length
      ? await UserCapacity.find({ user: { $in: allUserIds } }).lean()
      : [];
    const capByUser = new Map(capDocs.map((c) => [String(c.user), c]));
    const withCapacity = allRows.map((row) => ({
      ...row,
      userCapacity: capByUser.get(String(row._id)) || null,
    }));
    return success(res, withCapacity);
  } catch (error) {
    return failure(res, error.message || "Failed to fetch team users", 500);
  }
};

const getStrategistTeamCapacity = async (req, res) => {
  try {
    const ok = await ensureStrategistUser(req);
    if (!ok) return failure(res, "Only strategist can access this endpoint", 403);
    const docs = await TeamCapacity.find({}).sort({ role: 1 }).lean();
    const data = (docs || []).map((d) => ({
      role: d.role,
      reelCapacity: d.reelCapacity,
      postCapacity: d.postCapacity,
      carouselCapacity: d.carouselCapacity,
      updatedAt: d.updatedAt,
    }));
    return success(res, data);
  } catch (error) {
    return failure(res, error.message || "Failed to fetch team capacity", 500);
  }
};

const getStrategistLeaves = async (req, res) => {
  try {
    const ok = await ensureStrategistUser(req);
    if (!ok) return failure(res, "Only strategist can access this endpoint", 403);
    const leaves = await Leave.find({}).select("userId startDate endDate reason").lean();
    const normalized = (leaves || []).map((l) => ({
      leaveId: String(l._id),
      userId: String(l.userId),
      startDate: l.startDate,
      endDate: l.endDate,
      reason: l.reason || "",
    }));
    return success(res, normalized);
  } catch (error) {
    return failure(res, error.message || "Failed to fetch leaves", 500);
  }
};

const strategistDragTask = async (req, res) => {
  try {
    const ok = await ensureStrategistUser(req);
    if (!ok) {
      return failure(res, "Only strategist can use this endpoint", 403);
    }

    const { contentId, stageName, newDate, allowWeekend, fromGlobalCalendar, targetUserId } =
      req.body || {};
    const assignedClientIds = await getStrategistAssignedClientIds(req.user.id);

    const result = await runManagerDragTask({
      actorUserId: req.user.id,
      actorRole: "strategist",
      assignedClientIds,
      contentId,
      stageName,
      newDate,
      allowWeekend,
      fromGlobalCalendar: fromGlobalCalendar === true,
      targetUserId,
    });

    if (!result.ok) {
      return res.status(result.status || 400).json({
        success: false,
        error: result.error,
        details: result.details,
      });
    }
    return success(res, result.data);
  } catch (error) {
    return failure(res, error.message || "Drag task failed", 500);
  }
};

module.exports = {
  getMe,
  getMyTasks,
  updateMyTaskStatus,
  getTeamClient,
  getMyNotifications,
  markNotificationRead,
  getStrategistGlobalCalendar,
  getStrategistTeamUsers,
  getStrategistTeamCapacity,
  getStrategistLeaves,
  strategistDragTask,
};
