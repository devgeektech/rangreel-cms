const Client = require("../models/Client");
const ClientScheduleDraft = require("../models/ClientScheduleDraft");
const { detectCapacityConflicts } = require("../services/calendarConflict.service");
const {
  generateWorkflowStagesFromPostingDate,
} = require("../services/workflowFromPostingDate.service");

const success = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

const failure = (res, error, statusCode = 400) =>
  res.status(statusCode).json({ success: false, error });

const canAccessDraft = async (req, clientId, draft) => {
  if (req.user?.roleType === "admin") return true;

  if (req.user?.roleType === "manager") {
    const owned = await Client.findOne({ _id: clientId, manager: req.user.id })
      .select("_id")
      .lean();
    return Boolean(owned);
  }

  if (req.user?.roleType === "user") {
    const me = String(req.user.id);
    for (const item of draft?.items || []) {
      for (const s of item?.stages || []) {
        const au = s?.assignedUser?._id || s?.assignedUser;
        if (au && String(au) === me) return true;
      }
    }
  }

  return false;
};

/**
 * POST /calendar/check-conflicts
 * Body: { clientId, items: [...] } — same shape as internal calendar draft items.
 * Returns overload warnings (does not block).
 */
const checkConflicts = async (req, res) => {
  try {
    const { clientId, items } = req.body || {};
    if (!clientId) return failure(res, "clientId is required", 400);
    if (!Array.isArray(items)) return failure(res, "items must be an array", 400);

    const draft = await ClientScheduleDraft.findOne({ clientId }).lean();
    if (!draft) return failure(res, "Schedule draft not found", 404);

    const allowed = await canAccessDraft(req, clientId, draft);
    if (!allowed) return failure(res, "Forbidden", 403);

    const result = await detectCapacityConflicts(clientId, items);
    return success(res, result);
  } catch (err) {
    return failure(res, err.message || "Conflict check failed", 500);
  }
};

/**
 * Optional helper for client creation / tooling: backward stage template from posting date.
 * POST /calendar/preview-stages-from-posting
 */
const previewStagesFromPosting = async (req, res) => {
  try {
    const { postingDate, contentType } = req.body || {};
    if (!postingDate) return failure(res, "postingDate is required", 400);

    if (req.user?.roleType !== "admin" && req.user?.roleType !== "manager") {
      return failure(res, "Forbidden", 403);
    }

    const data = generateWorkflowStagesFromPostingDate(postingDate, contentType);
    return success(res, data);
  } catch (err) {
    return failure(res, err.message || "Preview failed", 400);
  }
};

module.exports = {
  checkConflicts,
  previewStagesFromPosting,
};
