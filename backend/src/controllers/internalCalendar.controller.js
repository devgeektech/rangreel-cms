const Client = require("../models/Client");
const ClientScheduleDraft = require("../models/ClientScheduleDraft");
const ContentItem = require("../models/ContentItem");
const Leave = require("../models/Leave");
const {
  getNextAvailableDate,
  suggestNextAvailableSlots,
} = require("../services/capacityAvailability.service");
const {
  validateStagesNotAfterPosting,
  isAfterDate,
} = require("../services/stageBoundary.service");
const { normalizeDraftItemToDurationTasks } = require("../services/taskNormalizer.service");
const { scheduleStageDay, buildHolidaySetUTC } = require("../services/simpleCalendar.service");
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
    const client = await Client.findById(clientId)
      .select("_id manager isCustomCalendar weekendEnabled")
      .lean();
    if (!client) return failure(res, "Client not found", 404);

    let allowed = false;
    if (req.user?.roleType === "admin") allowed = true;
    else if (req.user?.roleType === "manager") allowed = String(client.manager) === String(req.user.id);
    else if (req.user?.roleType === "user") {
      const assigned = await ContentItem.exists({
        client: clientId,
        "workflowStages.assignedUser": req.user.id,
      });
      allowed = Boolean(assigned);
    }
    if (!allowed) return failure(res, "Forbidden", 403);

    const items = await ContentItem.find({ client: clientId })
      .select("title displayId taskType taskNumber type contentType clientPostingDate workflowStages isCustomCalendar weekendEnabled client")
      .populate("client", "brandName clientName")
      .populate("workflowStages.assignedUser", "name avatar")
      .sort({ clientPostingDate: 1 });

    const payload = {
      clientId,
      isCustomCalendar: Boolean(client.isCustomCalendar),
      weekendEnabled: Boolean(client.weekendEnabled),
      items: (items || []).map((item) => ({
        contentId: item._id,
        title: item.title || "",
        displayId: resolveDisplayIdForRead(item),
        taskType: item.taskType || "",
        taskNumber: item.taskNumber || null,
        type: item.type || (item.contentType === "static_post" ? "post" : item.contentType),
        isCustomCalendar: Boolean(item.isCustomCalendar),
        weekendEnabled: Boolean(item.weekendEnabled),
        stages: (item.workflowStages || []).map((s) => ({
          stageId: s._id,
          name: s.stageName,
          role: s.role,
          assignedUser: s.assignedUser || null,
          date: toYMD(s.dueDate),
          status: s.status,
        })),
        postingDate: toYMD(item.clientPostingDate),
        isLocked: true,
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
    const postingDate = normalizeUTCDate(item.postingDate);
    if (postingDate && isAfterDate(requested, postingDate)) {
      return failure(res, "Stage date must not exceed posting date", 400);
    }

    const targetStage = stages[stageIndex];
    const oldTargetDate = normalizeUTCDate(targetStage?.date);
    const assignedUser = targetStage?.assignedUser;
    if (!assignedUser) return failure(res, "Stage has no assigned user", 400);

    // Prompt 80: urgent reels get a slight priority boost.
    const contentItemForPlan = await ContentItem.findById(contentId)
      .select("planType contentType type")
      .lean();
    const planType = String(contentItemForPlan?.planType || "normal").toLowerCase();
    const capacityDelta = planType === "urgent" ? 1 : 0;
    const rawCt = String(contentItemForPlan?.contentType || "").toLowerCase();
    let scheduleContentType = "static_post";
    if (rawCt === "reel") scheduleContentType = "reel";
    else if (rawCt === "carousel") scheduleContentType = "carousel";
    else scheduleContentType = "static_post";

    // Prompt 71: manager-controlled leave integration.
    // Fetch leave entries that overlap the search window so scheduler steps respect leave.
    const leaveStart = requested;
    const leaveEnd = addDaysUTC(requested, 365);
    const leaveDocs = await Leave.find({
      userId: assignedUser,
      startDate: { $lte: leaveEnd },
      endDate: { $gte: leaveStart },
    }).lean();
    const leaves = (leaveDocs || []).map((doc) => ({
      userId: doc.userId,
      from: doc.startDate,
      to: doc.endDate,
    }));

    const resolvedTargetDate = normalizeUTCDate(
      await getNextAvailableDate(
        targetStage.role,
        assignedUser,
        requested,
        { capacityDelta, leaves, contentType: scheduleContentType, contentTypeForTasks: scheduleContentType }
      )
    );
    // Prompt 74: manual drag/edit must not overload capacity.
    // If requested date is not immediately available, reject instead of auto-pushing.
    if (!isSameUTCDate(resolvedTargetDate, requested)) {
      const suggestions = await suggestNextAvailableSlots(
        targetStage.role,
        assignedUser,
        requested,
        {
          capacityDelta,
          leaves,
          contentType: scheduleContentType,
          contentTypeForTasks: scheduleContentType,
        }
      );
      return res.status(409).json({
        success: false,
        error: "All users unavailable",
        details: {
          code: "CAPACITY_EXCEEDED",
          stage: stageName,
          role: targetStage.role,
          assignedUser,
          requestedDate: toYMD(requested),
          resolvedDate: resolvedTargetDate ? toYMD(resolvedTargetDate) : "",
          suggestions,
        },
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
      let shiftedByDelta = normalizeUTCDate(addDaysUTC(oldNextDate, Math.round(deltaMs / 86400000)));
      if (postingDate && shiftedByDelta && shiftedByDelta.getTime() > postingDate.getTime()) {
        shiftedByDelta = postingDate;
      }
      const next = normalizeUTCDate(
        await getNextAvailableDate(s.role, s.assignedUser, shiftedByDelta, {
          capacityDelta,
          leaves,
          contentType: scheduleContentType,
          contentTypeForTasks: scheduleContentType,
        })
      );
      if (postingDate && next && next.getTime() > postingDate.getTime()) {
        s.date = postingDate;
      } else {
        s.date = next;
      }
    }

    // Prompt 79: keep post locked, but enforce dependency sanity against locked posting date.
    const approvalStage = stages.find((s) => String(s?.name) === "Approval");
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

    // Hard constraint: enforce strict stage sequence (Plan < Shoot < Edit < Approval < Post)
    const STAGE_ORDER = ["Plan", "Shoot", "Edit", "Approval", "Post"];
    const byName = new Map(
      stages.map((s) => [String(s?.name || s?.stageName || ""), normalizeUTCDate(s?.date)])
    );
    for (let i = 0; i < STAGE_ORDER.length - 1; i++) {
      const aName = STAGE_ORDER[i];
      const bName = STAGE_ORDER[i + 1];
      const aDate = byName.get(aName);
      const bDate = byName.get(bName);
      if (!aDate || !bDate) continue;
      if (aDate.getTime() >= bDate.getTime()) {
        return failure(res, "Task sequence would be violated by this drag", 409);
      }
    }
    const boundary = validateStagesNotAfterPosting(stages, postingDate);
    if (!boundary.ok) {
      return failure(res, "Stage date must not exceed posting date", 400);
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

    item.tasks = normalizeDraftItemToDurationTasks(item);
    draft.markModified("items");
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

const submitInternalCalendar = async (req, res) => {
  try {
    const { clientId } = req.params;
    const { items } = req.body || {};

    if (!clientId) return failure(res, "clientId is required", 400);
    if (!Array.isArray(items)) {
      return failure(res, "items must be an array", 400);
    }

    // Load the stored draft for access control and update the in-DB dates.
    const draft = await ClientScheduleDraft.findOne({ clientId }).lean();
    if (!draft) return failure(res, "Schedule draft not found", 404);

    const allowed = await canAccessDraft(req, clientId, draft);
    if (!allowed) return failure(res, "Forbidden", 403);

    // PROMPT 82: global-only edits must fetch ALL ContentItems (all clients).
    await ContentItem.find({}).select("_id").lean();

    const draftDoc = await ClientScheduleDraft.findOne({ clientId });
    if (!draftDoc) return failure(res, "Schedule draft not found", 404);

    const receivedByContentId = new Map(
      items.map((it) => [String(it?.contentId), it])
    );

    // Update draft items (dates only) based on what the UI submits.
    let boundaryError = "";
    draftDoc.items = (draftDoc.items || []).map((it) => {
      const key = it?.contentId ? String(it.contentId) : "";
      const incoming = receivedByContentId.get(key);
      if (!incoming) return it;

      // Posting date (Post stage) is locked; don't overwrite it from the UI payload.

      const stageByName = new Map(
        (incoming?.stages || []).map((s) => [String(s?.name), s])
      );

      it.stages = (it.stages || []).map((s) => {
        if (String(s?.name) === "Post") return s;
        const incomingStage = stageByName.get(String(s?.name));
        if (!incomingStage) return s;
        const d = normalizeUTCDate(incomingStage?.date);
        if (d) s.date = d;
        if (incomingStage?.status) s.status = incomingStage.status;
        return s;
      });

      const boundary = validateStagesNotAfterPosting(it.stages || [], it.postingDate);
      if (!boundary.ok) {
        boundaryError = "Stage date must not exceed posting date";
      }

      it.tasks = normalizeDraftItemToDurationTasks(it);
      return it;
    });
    if (boundaryError) return failure(res, boundaryError, 400);

    // Persist workflow stage dates into ContentItem documents as the final step.
    const receivedContentIds = Array.from(receivedByContentId.keys()).filter(Boolean);

    let contentBoundaryError = "";
    await Promise.all(
      receivedContentIds.map(async (contentId) => {
        const contentItem = await ContentItem.findById(contentId);
        if (!contentItem) return;

        const incoming = receivedByContentId.get(contentId);
        const stageByName = new Map(
          (incoming?.stages || []).map((s) => [String(s?.name), s])
        );

        contentItem.workflowStages = (contentItem.workflowStages || []).map((ws) => {
          if (String(ws?.stageName) === "Post") return ws;
          const incomingStage = stageByName.get(String(ws?.stageName));
          if (!incomingStage) return ws;
          const d = normalizeUTCDate(incomingStage?.date);
          if (d) ws.dueDate = d;
          if (incomingStage?.status) ws.status = incomingStage.status;
          return ws;
        });

        const postingDate = normalizeUTCDate(contentItem.clientPostingDate);
        if (!postingDate) {
          contentBoundaryError = "Posting date is missing";
          return;
        }

        const isManager =
          String(req.user?.roleType || "").toLowerCase() === "manager" ||
          String(req.user?.roleType || "").toLowerCase() === "admin";

        const allowWeekend = isManager;
        const allowFlexibleAdjustment = isManager;

        const stageOrder = ["Plan", "Shoot", "Edit", "Approval"];
        const editableStages = stageOrder
          .map((stageName) =>
            (contentItem.workflowStages || []).find((ws) => String(ws?.stageName) === stageName)
          )
          .filter(Boolean);

        const dueTimes = (editableStages || [])
          .map((s) => normalizeUTCDate(s.dueDate)?.getTime())
          .filter((t) => typeof t === "number" && Number.isFinite(t));
        const baseTime = dueTimes.length ? Math.min(...dueTimes) : postingDate.getTime();
        const windowStart = addDaysUTC(new Date(baseTime), -120);
        const windowEnd = addDaysUTC(postingDate, 365);

        const holidaySet = await buildHolidaySetUTC(windowStart, windowEnd);

        const assignedUserIds = Array.from(
          new Set(
            (editableStages || [])
              .map((s) => s.assignedUser)
              .filter(Boolean)
              .map((u) => String(u))
          )
        );

        const leavesDocs = assignedUserIds.length
          ? await Leave.find({
              userId: { $in: assignedUserIds },
              startDate: { $lte: windowEnd },
              endDate: { $gte: windowStart },
            }).lean()
          : [];

        const leaves = (leavesDocs || []).map((doc) => ({
          userId: doc.userId ? String(doc.userId._id || doc.userId) : "",
          from: doc.startDate,
          to: doc.endDate,
          reason: doc.reason || "",
        }));

        const schedulingOpts = {
          allowWeekend,
          allowFlexibleAdjustment,
          leaves,
          excludeContentItemId: contentItem._id,
        };

        // PROMPT 82: resubmission must run global scheduler and persist resolved dates.
        let prevResolved = null;
        for (const stageName of stageOrder) {
          const ws = (contentItem.workflowStages || []).find((x) => String(x?.stageName) === stageName);
          if (!ws) continue;

          let requested = normalizeUTCDate(ws.dueDate);
          if (!requested) continue;

          if (prevResolved && requested.getTime() <= prevResolved.getTime()) {
            requested = addDaysUTC(prevResolved, 1);
          }

          const resolved = await scheduleStageDay(
            ws.role,
            ws.assignedUser,
            requested,
            holidaySet,
            schedulingOpts
          );

          if (postingDate && resolved.getTime() >= postingDate.getTime()) {
            contentBoundaryError = "Cannot maintain post date";
            return;
          }

          ws.dueDate = resolved;
          prevResolved = resolved;
        }

        const boundary = validateStagesNotAfterPosting(
          (contentItem.workflowStages || []).map((ws) => ({
            stageName: ws.stageName,
            dueDate: ws.dueDate,
          })),
          postingDate
        );
        if (!boundary.ok) {
          contentBoundaryError = "Stage date must not exceed posting date";
          return;
        }

        await contentItem.save();

        // Keep the draft items in sync with resolved dates.
        const draftItem = (draftDoc.items || []).find(
          (it) => String(it?.contentId) === String(contentId)
        );
        if (draftItem) {
          draftItem.stages = (draftItem.stages || []).map((s) => {
            if (String(s?.name) === "Post") return s;
            const ws = (contentItem.workflowStages || []).find((x) => String(x?.stageName) === String(s?.name));
            if (!ws) return s;
            return { ...s, date: ws.dueDate, status: s.status };
          });
          draftItem.tasks = normalizeDraftItemToDurationTasks(draftItem);
        }
      })
    );
    if (contentBoundaryError) return failure(res, contentBoundaryError, 400);

    draftDoc.markModified("items");
    await draftDoc.save();

    return res.status(200).json({ success: true });
  } catch (err) {
    return failure(res, err.message || "Failed to submit internal calendar", 500);
  }
};

module.exports = {
  getInternalCalendar,
  updateInternalCalendarStage,
  submitInternalCalendar,
};

