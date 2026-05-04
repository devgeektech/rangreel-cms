const ContentItem = require("../models/ContentItem");
const Client = require("../models/Client");
const { resolveDisplayIdForRead } = require("../utils/taskDisplayId.util");

const isStrategistActor = (req) => {
  const dash = String(req.user?.dashboardRoute || "").toLowerCase();
  if (dash.startsWith("/strategist")) return true;
  return String(req.user?.roleSlug || "").toLowerCase() === "strategist";
};

const strategistRefForItem = (clientTeam, contentType, type) => {
  const ct = String(contentType || "").toLowerCase();
  const t = String(type || "").toLowerCase();
  if (!clientTeam) return null;
  if (ct === "static_post" || t === "post") return clientTeam.posts?.strategist;
  if (ct === "carousel") return clientTeam.carousel?.strategist;
  return clientTeam.reels?.strategist;
};

const canStrategistEditAliasForItem = (userId, item, clientDoc) => {
  const uid = String(userId || "");
  const planStage = (item.workflowStages || []).find(
    (s) => String(s?.stageName || "").toLowerCase() === "plan"
  );
  const planUser = planStage?.assignedUser;
  if (planUser && String(planUser) === uid) return true;
  const team = clientDoc?.team;
  const ref = strategistRefForItem(team, item.contentType, item.type);
  return ref && String(ref) === uid;
};

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

const canReadContentItem = async (req, _item) => {
  return Boolean(req.user && req.user.id);
};

/**
 * GET content by id — includes strategist Plan stage fields for detail dialogs
 * (videographer, editor, posting executive, manager, etc.).
 */
const getContentById = async (req, res) => {
  try {
    const { id } = req.params;

    const item = await ContentItem.findById(id)
      .populate(
        "client",
        [
          "clientName",
          "brandName",
          "industry",
          "businessType",
          "contactNumber",
          "email",
          "website",
          "startDate",
          "endDate",
          "status",
          "socialHandles",
          "socialCredentialsNotes",
          "clientBrief",
        ].join(" ")
      )
      .populate("workflowStages.assignedUser", "name avatar")
      .lean();

    if (!item) return failure(res, "ContentItem not found", 404);

    const allowed = await canReadContentItem(req, item);
    if (!allowed) return failure(res, "Forbidden", 403);

    const planStage = (item.workflowStages || []).find(
      (s) => String(s?.stageName || "").toLowerCase() === "plan"
    );
    const clientId =
      item?.client && typeof item.client === "object"
        ? String(item.client?._id || "")
        : String(item?.client || "");
    let clientDoc =
      item?.client && typeof item.client === "object" && item.client.clientName
        ? item.client
        : null;
    if (!clientDoc && clientId) {
      clientDoc = await Client.findById(clientId)
        .select(
          [
            "clientName",
            "brandName",
            "industry",
            "businessType",
            "contactNumber",
            "email",
            "website",
            "startDate",
            "endDate",
            "status",
            "socialHandles",
            "socialCredentialsNotes",
            "clientBrief",
          ].join(" ")
        )
        .lean();
    }

    return success(res, {
      _id: item._id,
      clientId,
      title: item.title,
      strategistAlias: String(item.strategistAlias || "").trim(),
      displayId: resolveDisplayIdForRead(item),
      taskNumber: item.taskNumber || null,
      taskType: item.taskType || "",
      contentType: item.contentType || "",
      type: item.type || "",
      planType: item.planType || item.plan || "normal",
      hook: planStage?.hook != null ? String(planStage.hook) : "",
      concept: planStage?.concept != null ? String(planStage.concept) : "",
      captionDirection:
        planStage?.captionDirection != null ? String(planStage.captionDirection) : "",
      contentBrief: Array.isArray(planStage?.contentBrief) ? planStage.contentBrief : [],
      videoUrl: item.videoUrl || "",
      client: clientDoc
        ? {
            clientName: clientDoc.clientName || "",
            brandName: clientDoc.brandName || "",
            industry: clientDoc.industry || "",
            businessType: clientDoc.businessType || "",
            contactNumber: clientDoc.contactNumber || "",
            email: clientDoc.email || "",
            website: clientDoc.website || "",
            startDate: clientDoc.startDate || null,
            endDate: clientDoc.endDate || null,
            status: clientDoc.status || "",
            socialHandles: clientDoc.socialHandles || {},
            socialCredentialsNotes: clientDoc.socialCredentialsNotes || "",
            clientBrief: clientDoc.clientBrief || {},
          }
        : null,
      stages: (item.workflowStages || []).map((s) => ({
        _id: s._id,
        stageName: s.stageName,
        role: s.role,
        status: s.status,
        dueDate: toYMD(s.dueDate),
        completedAt: toYMD(s.completedAt),
        rejectionNote: s.rejectionNote,
        assignedUser: s.assignedUser || null,
        footageLink: s.footageLink != null ? String(s.footageLink) : "",
        editedFileLink: s.editedFileLink != null ? String(s.editedFileLink) : "",
        designFileLink: s.designFileLink != null ? String(s.designFileLink) : "",
      })),
    });
  } catch (err) {
    return failure(res, err.message || "Failed to fetch content item", 500);
  }
};

const patchStrategistAlias = async (req, res) => {
  try {
    if (!req.user?.id) return failure(res, "Unauthorized", 401);
    if (!isStrategistActor(req)) return failure(res, "Forbidden", 403);

    const { id } = req.params;
    if (!id) return failure(res, "Content id is required", 400);

    const body = req.body || {};
    if (!Object.prototype.hasOwnProperty.call(body, "strategistAlias")) {
      return failure(res, "strategistAlias is required (use empty string to clear)", 400);
    }
    const strategistAlias = String(body.strategistAlias ?? "").trim().slice(0, 200);

    const item = await ContentItem.findById(id)
      .populate("client", "team")
      .select("client contentType type workflowStages strategistAlias")
      .lean();
    if (!item) return failure(res, "ContentItem not found", 404);

    const clientDoc =
      item.client && typeof item.client === "object" ? item.client : null;
    if (!canStrategistEditAliasForItem(req.user.id, item, clientDoc)) {
      return failure(res, "Forbidden", 403);
    }

    await ContentItem.updateOne({ _id: id }, { $set: { strategistAlias } });

    const fresh = await ContentItem.findById(id).select("strategistAlias title displayId").lean();
    return success(res, {
      strategistAlias: String(fresh?.strategistAlias || "").trim(),
      displayId: resolveDisplayIdForRead(fresh),
      title: fresh?.title || "",
    });
  } catch (err) {
    return failure(res, err.message || "Failed to update display name", 500);
  }
};

module.exports = {
  getContentById,
  patchStrategistAlias,
};
