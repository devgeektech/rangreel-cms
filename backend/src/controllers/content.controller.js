const ContentItem = require("../models/ContentItem");
// const PublicHoliday = require("../models/PublicHoliday"); // Prompt 20 safe cleanup: keep model, stop using in runtime flow.
const Client = require("../models/Client");
const ClientScheduleDraft = require("../models/ClientScheduleDraft");
const Leave = require("../models/Leave");
const { notifyUsers } = require("../services/workflowNotification.service");
const {
  scheduleStageDay,
  buildHolidaySetUTC,
} = require("../services/simpleCalendar.service");
const { validateStagesNotAfterPosting } = require("../services/stageBoundary.service");
const { normalizeDraftItemToDurationTasks } = require("../services/taskNormalizer.service");

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

const USER_EDITABLE_STAGES = new Set(["Plan", "Shoot", "Edit", "Approval"]);

const resolveTeamByContentType = (team, contentType) => {
  const ct = String(contentType || "").toLowerCase();
  if (ct === "reel") return team?.reels || {};
  if (ct === "carousel") return team?.carousel || {};
  return team?.posts || {};
};

async function fetchLeavesForUsers(userIds, startDate, endDate) {
  const ids = (userIds || []).filter(Boolean).map((x) => String(x));
  if (ids.length === 0) return [];
  const leavesDocs = await Leave.find({
    userId: { $in: ids },
    startDate: { $lte: endDate },
    endDate: { $gte: startDate },
  }).lean();

  return (leavesDocs || []).map((doc) => ({
    userId: doc.userId && doc.userId._id ? String(doc.userId._id) : String(doc.userId),
    from: doc.startDate,
    to: doc.endDate,
    reason: doc.reason || "",
  }));
}

function toStageDateList(stages) {
  return (stages || []).map((s) => ({ stageName: s.stageName, dueDate: s.dueDate }));
}

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

const getSharedContentDetails = async (req, res) => {
  try {
    const { id } = req.params;

    let item = await ContentItem.findById(id)
      .populate("client", "clientName brandName")
      .populate("workflowStages.assignedUser", "name role");

    // Fallback: allow links built from stage-level ids to still resolve the parent content item.
    if (!item) {
      item = await ContentItem.findOne({ "workflowStages._id": id })
        .populate("client", "clientName brandName")
        .populate("workflowStages.assignedUser", "name role");
    }

    if (!item) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const planStage = (item.workflowStages || []).find(
      (stage) => String(stage?.stageName || "").toLowerCase() === "plan"
    );

    return res.json({
      success: true,
      data: {
        _id: item._id,
        title: item.title,
        contentBrief: item.contentBrief || planStage?.contentBrief || [],
        videoUrl: item.videoUrl || "",
        client: item.client,
        stages: (item.workflowStages || []).map((stage) => ({
          _id: stage._id,
          stageName: stage.stageName,
          role: stage.role,
          status: stage.status,
          dueDate: stage.dueDate,
          assignedUser: stage.assignedUser || null,
        })),
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

const getStageIndexById = (stages, stageId) => {
  if (!stageId) return -1;
  return stages.findIndex((s) => s._id && s._id.toString() === String(stageId));
};

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function isWeekend(date) {
  const d = new Date(date).getDay();
  return d === 0 || d === 6;
}

function nextWeekday(date) {
  let d = new Date(date);
  for (let i = 0; i < 7; i += 1) {
    if (!isWeekend(d)) return d;
    d = addDays(d, 1);
  }
  return d;
}

const moveStage = async (req, res) => {
  try {
    const { itemId, stageId } = req.params;
    const item = await ContentItem.findById(itemId);
    if (!item) return failure(res, "ContentItem not found", 404);

    // Manager global calendar must remain editable under scheduler rules.
    // Preserve legacy non-custom fallback only for non-global edit paths.
    if (item.isCustomCalendar === false && !req.body?.fromGlobalCalendar) {
      const oldReshuffleLogic = () => {
        const mergedBody = {
          ...(req.body || {}),
          newDueDate: req.body?.dueDate || req.body?.newDueDate,
        };
        req.body = mergedBody;
        return reshuffleStage(req, res);
      };
      return oldReshuffleLogic();
    }

    const stages = item.workflowStages;
    const index = stages.findIndex((s) => s?._id && s._id.equals(stageId));
    if (index === -1) return failure(res, "Stage not found", 404);
    const stage = stages[index];
    const prevStage = stages[index - 1];
    const nextStage = stages[index + 1];

    const incomingDueDate = req.body?.dueDate;
    if (!incomingDueDate) return failure(res, "dueDate is required", 400);

    const allowWeekendOverride = req.body?.allowWeekend === true;
    if (!item.weekendEnabled && !allowWeekendOverride && isWeekend(incomingDueDate)) {
      throw new Error("Weekend scheduling is disabled");
    }

    const stageName = String(stage.stageName || "").toLowerCase();

    if (stageName === "post") {
      const oldDate = new Date(stage.dueDate);
      const newDate = new Date(incomingDueDate);
      const diff = Math.floor((newDate - oldDate) / (1000 * 60 * 60 * 24));
      let prevDue = null;
      item.workflowStages = item.workflowStages.map((s) => {
        let shifted = addDays(s.dueDate, diff);
        if (!item.weekendEnabled) {
          shifted = nextWeekday(shifted);
        }
        if (prevDue && shifted.getTime() <= prevDue.getTime()) {
          shifted = addDays(prevDue, 1);
          if (!item.weekendEnabled) shifted = nextWeekday(shifted);
        }
        prevDue = shifted;
        return {
          ...s.toObject(),
          dueDate: shifted,
        };
      });
      await item.save();
      return res.json({
        success: true,
        data: item,
      });
    }

    let adjustedDate = new Date(incomingDueDate);

    if (prevStage && adjustedDate <= new Date(prevStage.dueDate)) {
      throw new Error("Move previous stage first");
    }

    if (nextStage) {
      const duration = Number(stage?.duration) || 1;
      const end = addDays(adjustedDate, duration - 1);
      if (end >= new Date(nextStage.dueDate)) {
        throw new Error("Adjust next stage first");
      }
    }
    stage.dueDate = adjustedDate;

    await item.save();
    return res.json({
      success: true,
      data: item,
    });
  } catch (err) {
    return failure(res, err.message || "Failed to move stage", 500);
  }
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

    // PROMPT 82: global-only edits must fetch ALL ContentItems.
    await ContentItem.find({}).select("_id").lean();

    const targetStage = contentItem.workflowStages[stageIndex];
    const targetStageName = String(targetStage?.stageName || "");
    if (targetStageName === "Post") {
      return failure(res, "Posting date cannot be changed", 400);
    }

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

    // PROMPT 82: run global scheduler for this stage and shift following editable stages.
    const postStage = (contentItem.workflowStages || []).find(
      (s) => String(s?.stageName || "") === "Post"
    );
    const postingDate = postStage?.dueDate ? normalizeUtcMidnight(postStage.dueDate) : null;

    const schedulingLeaves = await fetchLeavesForUsers(
      (contentItem.workflowStages || [])
        .filter((s) => USER_EDITABLE_STAGES.has(String(s?.stageName || "")) && s?.assignedUser)
        .map((s) => s.assignedUser),
      addDaysUTC(normalizedDueDate, -120),
      addDaysUTC(normalizedDueDate, 365)
    );

    const holidaySet = await buildHolidaySetUTC(
      addDaysUTC(normalizedDueDate, -120),
      postingDate ? addDaysUTC(postingDate, 365) : addDaysUTC(normalizedDueDate, 365)
    );

    const schedulingOpts = {
      allowWeekend: true,
      allowFlexibleAdjustment: true,
      leaves: schedulingLeaves,
      excludeContentItemId: contentItem._id,
    };

    const oldTargetDate = normalizeUtcMidnight(targetStage?.dueDate);
    const resolvedTarget = await scheduleStageDay(
      targetStage.role,
      targetStage.assignedUser,
      normalizedDueDate,
      holidaySet,
      schedulingOpts
    );
    if (!resolvedTarget) return failure(res, "Failed to resolve scheduled date", 409);

    if (postingDate && resolvedTarget.getTime() >= postingDate.getTime()) {
      return failure(res, "Cannot maintain post date", 409);
    }

    contentItem.workflowStages[stageIndex].dueDate = resolvedTarget;

    const deltaMs = oldTargetDate
      ? resolvedTarget.getTime() - oldTargetDate.getTime()
      : 0;

    for (let i = stageIndex + 1; i < contentItem.workflowStages.length; i++) {
      const s = contentItem.workflowStages[i];
      const name = String(s?.stageName || "");
      if (!USER_EDITABLE_STAGES.has(name)) break; // stop at Post
      if (!s?.assignedUser) continue;

      const oldNextDate =
        normalizeUtcMidnight(s.dueDate) ||
        addDaysUTC(resolvedTarget, i - stageIndex);
      let anchor = normalizeUtcMidnight(
        addDaysUTC(oldNextDate, Math.round(deltaMs / 86400000))
      );
      if (!anchor) anchor = addDaysUTC(resolvedTarget, i - stageIndex);

      if (postingDate && anchor.getTime() >= postingDate.getTime()) {
        return failure(res, "Cannot maintain post date", 409);
      }

      const nextDue = await scheduleStageDay(
        s.role,
        s.assignedUser,
        anchor,
        holidaySet,
        schedulingOpts
      );
      if (postingDate && nextDue.getTime() >= postingDate.getTime()) {
        return failure(res, "Cannot maintain post date", 409);
      }

      s.dueDate = nextDue;
    }

    // Final hard check: no stage can move beyond Post; keep strict order.
    validateStrictStageOrder(
      contentItem.workflowStages.map((ws) => ({
        stageName: ws.stageName,
        dueDate: ws.dueDate,
      }))
    );
    const boundary = validateStagesNotAfterPosting(
      contentItem.workflowStages,
      postingDate
    );
    if (!boundary.ok) {
      return failure(res, "Cannot maintain post date", 409);
    }

    await contentItem.save();

    // Keep editable draft copy in sync (timeline UI uses ClientScheduleDraft).
    const draft = await ClientScheduleDraft.findOne({ "items.contentId": contentItem._id });
    if (draft) {
      const draftItem = (draft.items || []).find(
        (it) => String(it.contentId) === String(contentItem._id)
      );
      if (draftItem) {
        draftItem.stages = (draftItem.stages || []).map((s) => {
          const ws = (contentItem.workflowStages || []).find(
            (x) => String(x.stageName || "") === String(s.name || "")
          );
          if (!ws) return s;
          if (String(s.name || "") === "Post") return s;
          return { ...s, date: ws.dueDate, status: s.status || "assigned" };
        });
        draftItem.tasks = normalizeDraftItemToDurationTasks(draftItem);
        await draft.save();
      }
    }

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

    // Manager approval should validate the latest production stage before Approval.
    // Reels typically use Edit; static/carousel flows may use Design/Work.
    let editStageIndex = -1;
    let designStageIndex = -1;
    for (let i = stageIndex - 1; i >= 0; i--) {
      const candidateName = String(contentItem.workflowStages[i]?.stageName || "").toLowerCase();
      if (candidateName === "edit") {
        editStageIndex = i;
      }
      if (candidateName === "design" || candidateName === "work") {
        designStageIndex = i;
      }
      if (editStageIndex !== -1 || designStageIndex !== -1) {
        break;
      }
    }

    const productionStageIndex =
      editStageIndex !== -1 ? editStageIndex : designStageIndex;

    if (productionStageIndex === -1) {
      return failure(
        res,
        "Cannot approve/reject without a previous Edit or Design stage",
        400
      );
    }

    const productionStage = contentItem.workflowStages[productionStageIndex];
    if (String(productionStage.status || "").toLowerCase() !== "completed") {
      const prodName = String(productionStage.stageName || "previous stage");
      return failure(
        res,
        `${prodName} stage must be completed before approval`,
        400
      );
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

      // Rejection path: send the latest production stage back to in_progress.
      productionStage.status = "in_progress";
      productionStage.completedAt = undefined;
      productionStage.rejectionNote = note;
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

    const clientWithTeam = await Client.findById(contentItem.client)
      .select("team")
      .lean();
    const teamForType = resolveTeamByContentType(clientWithTeam?.team || {}, contentItem?.contentType);
    const titleText = contentItem?.title || "Content item";

    if (status === "rejected") {
      await notifyUsers({
        userIds: teamForType?.videoEditor ? [teamForType.videoEditor] : [],
        title: "Approval Rejected",
        message: `${titleText} rejected. Please rework.`,
        type: "approval",
        contentId: contentItem._id,
      });
    }

    if (status === "approved") {
      await notifyUsers({
        userIds: teamForType?.postingExecutive ? [teamForType.postingExecutive] : [],
        title: "Approval Granted",
        message: `${titleText} approved. Ready to post.`,
        type: "approval",
        contentId: contentItem._id,
      });
    }

    return success(res, {
      itemId: contentItem._id,
      stage,
      overallStatus: contentItem.overallStatus,
    });
  } catch (err) {
    return failure(res, err.message || "Failed to update stage status", 500);
  }
};

const STAGE_ORDER = ["Plan", "Shoot", "Edit", "Approval", "Post"];

const validateStrictStageOrder = (stages) => {
  const byName = new Map((stages || []).map((s) => [String(s.stageName || s.name), s]));
  for (let i = 0; i < STAGE_ORDER.length - 1; i++) {
    const a = byName.get(STAGE_ORDER[i]);
    const b = byName.get(STAGE_ORDER[i + 1]);
    if (!a || !b) continue;
    const da = normalizeUtcMidnight(a.dueDate || a.date);
    const db = normalizeUtcMidnight(b.dueDate || b.date);
    if (!da || !db || da.getTime() >= db.getTime()) throw new Error("Invalid stage order");
  }
};

const patchContentItemStages = async (req, res) => {
  try {
    const { id } = req.params;
    const { stages } = req.body || {};
    if (!Array.isArray(stages) || stages.length === 0) {
      return failure(res, "stages is required", 400);
    }

    // PROMPT 82: global-only edits must fetch ALL ContentItems.
    await ContentItem.find({}).select("_id").lean();

    const contentItem = await ContentItem.findById(id);
    if (!contentItem) return failure(res, "ContentItem not found", 404);

    const client = await Client.findOne({ _id: contentItem.client, manager: req.user.id }).select("_id");
    if (!client) return failure(res, "Client not found or access denied", 403);

    const incomingByName = new Map(
      stages.map((s) => [String(s?.stageName || s?.name || ""), normalizeUtcMidnight(s?.dueDate || s?.date)])
    );

    const postStage = (contentItem.workflowStages || []).find(
      (s) => String(s?.stageName || "") === "Post"
    );
    const postingDate = postStage?.dueDate ? normalizeUtcMidnight(postStage.dueDate) : null;
    if (!postingDate) return failure(res, "Cannot maintain post date", 409);

    const postExisting = (contentItem.workflowStages || []).find(
      (s) => String(s?.stageName || "") === "Post"
    );
    const postIncoming = incomingByName.get("Post");
    if (postIncoming && postExisting?.dueDate) {
      const existingPost = normalizeUtcMidnight(postExisting.dueDate);
      if (existingPost && postIncoming.getTime() !== existingPost.getTime()) {
        return failure(res, "Post phase cannot be edited after creation", 400);
      }
    }

    const stageOrderIndex = {
      Plan: 0,
      Shoot: 1,
      Edit: 2,
      Approval: 3,
      Post: 4,
    };

    // Compute earliest changed editable stage.
    const oldDueByName = new Map(
      (contentItem.workflowStages || []).map((ws) => [String(ws.stageName || ""), normalizeUtcMidnight(ws.dueDate)])
    );

    let targetStageName = null;
    for (const name of ["Plan", "Shoot", "Edit", "Approval"]) {
      if (!incomingByName.has(name)) continue;
      const oldD = oldDueByName.get(name);
      const newD = incomingByName.get(name);
      if (!oldD || !newD) continue;
      if (oldD.getTime() !== newD.getTime()) {
        targetStageName = name;
        break;
      }
    }

    if (!targetStageName) {
      // Nothing editable changed.
      return success(res, { itemId: contentItem._id });
    }

    const oldTarget = oldDueByName.get(targetStageName);
    const newTarget = incomingByName.get(targetStageName);
    if (!oldTarget || !newTarget) return failure(res, "Invalid stage dates", 400);

    const deltaDays = Math.round((newTarget.getTime() - oldTarget.getTime()) / 86400000);

    const windowStart = addDaysUTC(oldTarget, -120);
    const windowEnd = addDaysUTC(postingDate, 365);
    const holidaySet = await buildHolidaySetUTC(windowStart, windowEnd);

    const assignedUsers = (contentItem.workflowStages || [])
      .filter((s) => USER_EDITABLE_STAGES.has(String(s?.stageName || "")) && s?.assignedUser)
      .map((s) => s.assignedUser);

    const leaves = await fetchLeavesForUsers(assignedUsers, windowStart, windowEnd);

    const schedulingOpts = {
      allowWeekend: true,
      allowFlexibleAdjustment: true,
      leaves,
      excludeContentItemId: contentItem._id,
    };

    // Reschedule only from target stage forward.
    let prevResolvedDue = null;
    const startIdx = stageOrderIndex[targetStageName];
    for (let i = 0; i < (contentItem.workflowStages || []).length; i++) {
      const ws = contentItem.workflowStages[i];
      const name = String(ws.stageName || "");
      if (!USER_EDITABLE_STAGES.has(name)) continue;

      const order = stageOrderIndex[name];
      if (order < startIdx) continue;
      if (!ws?.assignedUser) continue;

      const baseOldDue = oldDueByName.get(name);
      const incomingDate = incomingByName.get(name);

      // Prefer incoming anchor for target stage; for other stages use delta shift when incoming not provided.
      let anchor = incomingDate
        ? incomingDate
        : baseOldDue
        ? addDaysUTC(baseOldDue, deltaDays)
        : normalizeUtcMidnight(ws.dueDate);

      if (!anchor) continue;
      if (prevResolvedDue && anchor.getTime() <= prevResolvedDue.getTime()) {
        anchor = addDaysUTC(prevResolvedDue, 1);
      }

      const resolved = await scheduleStageDay(
        ws.role,
        ws.assignedUser,
        anchor,
        holidaySet,
        schedulingOpts
      );

      if (postingDate && resolved.getTime() >= postingDate.getTime()) {
        return failure(res, "Cannot maintain post date", 409);
      }

      ws.dueDate = resolved;
      prevResolvedDue = resolved;
    }

    validateStrictStageOrder(
      contentItem.workflowStages.map((ws) => ({
        stageName: ws.stageName,
        dueDate: ws.dueDate,
      }))
    );

    const boundary = validateStagesNotAfterPosting(contentItem.workflowStages, postingDate);
    if (!boundary.ok) {
      return failure(res, "Cannot maintain post date", 409);
    }

    // Persist.
    await contentItem.save();

    // Keep editable draft copy in sync.
    const draft = await ClientScheduleDraft.findOne({ "items.contentId": contentItem._id });
    if (draft) {
      const item = (draft.items || []).find((it) => String(it.contentId) === String(contentItem._id));
      if (item) {
        item.stages = (item.stages || []).map((s) => {
          const key = String(s.name || "");
          const ws = (contentItem.workflowStages || []).find((x) => String(x.stageName || "") === key);
          if (!ws || key === "Post") return s;
          return { ...s, date: ws.dueDate, status: s.status || "assigned" };
        });
        item.tasks = normalizeDraftItemToDurationTasks(item);
        await draft.save();
      }
    }

    return success(res, { itemId: contentItem._id });
  } catch (err) {
    return failure(res, err.message || "Failed to update stages", 500);
  }
};

module.exports = {
  getContentById,
  getSharedContentDetails,
  moveStage,
  reshuffleStage,
  updateStageStatus,
  patchContentItemStages,
};

