const Client = require("../models/Client");
const Package = require("../models/Package");
const { generateClientReels } = require("../services/simpleCalendar.service");
const ContentItem = require("../models/ContentItem");

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

const ymdUTC = (d) => {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const ensureClientOwnership = async (req, clientId) => {
  return Client.findOne({ _id: clientId, manager: req.user.id }).select("_id");
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

const dedupeById = (docs) => {
  const out = [];
  const seen = new Set();
  for (const d of docs || []) {
    const id = d?._id ? String(d._id) : "";
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(d);
  }
  return out;
};

const dedupeByStageId = (stages) => {
  const out = [];
  const seen = new Set();
  for (const s of stages || []) {
    const id = s?._id ? String(s._id) : s?.stageId ? String(s.stageId) : "";
    if (!id) {
      out.push(s);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(s);
  }
  return out;
};

const populateClientQuery = (query) => {
  return query
    .populate("package")
    .populate("team.strategist")
    .populate("team.videographer")
    .populate("team.videoEditor")
    .populate("team.graphicDesigner")
    .populate("team.postingExecutive")
    .populate("team.campaignManager")
    .populate("team.photographer");
};

const createClient = async (req, res) => {
  try {
    const {
      clientName,
      brandName,
      industry,
      businessType,
      socialHandles,
      startDate,
      status,
      package: packageId,
      team,
      googleReviewsTarget: bodyReviewsTarget,
      googleReviewsAchieved: bodyReviewsAchieved,
    } = req.body;

    if (!packageId) {
      return failure(res, "package is required", 400);
    }

    const pkg = await Package.findById(packageId).select("noOfGoogleReviews").lean();
    const googleReviewsTarget =
      typeof bodyReviewsTarget === "number"
        ? Math.max(0, bodyReviewsTarget)
        : pkg?.noOfGoogleReviews ?? 0;
    const googleReviewsAchieved =
      typeof bodyReviewsAchieved === "number" ? Math.max(0, bodyReviewsAchieved) : 0;

    const client = await Client.create({
      clientName,
      brandName,
      industry,
      businessType,
      socialHandles,
      startDate,
      // endDate is computed by calendar generation.
      status,
      googleReviewsTarget,
      googleReviewsAchieved,
      manager: req.user.id,
      package: packageId,
      team,
      createdBy: req.user.id,
    });

    // Prompt 16: only run the new simple calendar service.
    await generateClientReels(client);

    const populated = await populateClientQuery(Client.findById(client._id));
    return success(res, populated, 201);
  } catch (err) {
    return failure(res, err.message || "Failed to create client", 500);
  }
};

const getClients = async (req, res) => {
  try {
    const clients = await populateClientQuery(
      Client.find({ manager: req.user.id })
    ).sort({ createdAt: -1 });
    return success(res, clients);
  } catch (err) {
    return failure(res, err.message || "Failed to fetch clients", 500);
  }
};

const getClient = async (req, res) => {
  try {
    const { id } = req.params;

    const clientQuery = Client.findOne({ _id: id, manager: req.user.id });
    const client = await populateClientQuery(clientQuery);

    if (!client) {
      return failure(res, "Client not found", 404);
    }

    return success(res, client);
  } catch (err) {
    return failure(res, err.message || "Failed to fetch client", 500);
  }
};

const updateClient = async (req, res) => {
  try {
    const { id } = req.params;
    const { package: _package, team: _team, manager: _manager, createdBy: _createdBy, ...rest } = req.body || {};

    if (_package || _team) {
      return failure(res, "package and team cannot be updated", 400);
    }

    const clientQuery = Client.findOne({ _id: id, manager: req.user.id });
    const client = await clientQuery;
    if (!client) {
      return failure(res, "Client not found", 404);
    }

    const allowedFields = [
      "clientName",
      "brandName",
      "industry",
      "businessType",
      "socialHandles",
      "startDate",
      "status",
    ];

    allowedFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(rest, field)) {
        client[field] = rest[field];
      }
    });

    await client.save();

    const populated = await populateClientQuery(Client.findById(client._id));
    return success(res, populated);
  } catch (err) {
    return failure(res, err.message || "Failed to update client", 500);
  }
};

const updateClientGoogleReviews = async (req, res) => {
  try {
    const { id } = req.params;
    const { googleReviewsTarget, googleReviewsAchieved } = req.body || {};

    const client = await Client.findOne({ _id: id, manager: req.user.id });
    if (!client) {
      return failure(res, "Client not found", 404);
    }

    if (googleReviewsTarget !== undefined) {
      const n = Number(googleReviewsTarget);
      if (!Number.isFinite(n) || n < 0) {
        return failure(res, "googleReviewsTarget must be a non-negative number", 400);
      }
      client.googleReviewsTarget = n;
    }

    if (googleReviewsAchieved !== undefined) {
      const n = Number(googleReviewsAchieved);
      if (!Number.isFinite(n) || n < 0) {
        return failure(res, "googleReviewsAchieved must be a non-negative number", 400);
      }
      client.googleReviewsAchieved = n;
    }

    await client.save();

    const populated = await populateClientQuery(Client.findById(client._id));
    return success(res, populated);
  } catch (err) {
    return failure(res, err.message || "Failed to update Google reviews progress", 500);
  }
};

module.exports = {
  createClient,
  getClients,
  getClient,
  updateClient,
  updateClientGoogleReviews,
  getClientCalendar: async (req, res) => {
    try {
      const { id } = req.params;
      const month = req.query.month;

      if (!normalizeMonthTarget(month)) {
        return failure(res, "month must be in format YYYY-MM", 400);
      }

      const ownedClient = await ensureClientOwnership(req, id);
      if (!ownedClient) {
        return failure(res, "Client not found", 404);
      }

      const itemsRaw = await ContentItem.find({ client: id, month }).select(
        "title clientPostingDate planType plan"
      );
      const items = dedupeById(itemsRaw);

      const payload = items
        .sort((a, b) => new Date(a.clientPostingDate) - new Date(b.clientPostingDate))
        .map((item) => ({
          title: item.title,
          postingDate: toYMD(item.clientPostingDate),
          planType: item.planType || item.plan || "normal",
        }));

      return success(res, payload);
    } catch (err) {
      return failure(res, err.message || "Failed to fetch client calendar", 500);
    }
  },
  getTeamCalendar: async (req, res) => {
    try {
      const { id } = req.params;
      const month = req.query.month;

      const target = normalizeMonthTarget(month);
      if (!target) {
        return failure(res, "month must be in format YYYY-MM", 400);
      }

      const ownedClient = await ensureClientOwnership(req, id);
      if (!ownedClient) {
        return failure(res, "Client not found", 404);
      }

      // IMPORTANT:
      // Team calendar must be filtered by STAGE dueDate month, not by contentItem.month (posting month),
      // otherwise approval/edit stages can disappear when they fall in a different month.
      const startDate = new Date(
        `${target.year}-${String(target.month).padStart(2, "0")}-01T00:00:00.000Z`
      );
      const endDate = new Date(
        `${target.year}-${String(target.month).padStart(2, "0")}-31T23:59:59.999Z`
      );

      const itemsRaw = await ContentItem.find({
        client: id,
        "workflowStages.dueDate": { $gte: startDate, $lte: endDate },
      })
        .select("title workflowStages clientPostingDate planType plan")
        .populate("workflowStages.assignedUser", "name avatar")
        .sort({ clientPostingDate: 1 });
      const items = dedupeById(itemsRaw);

      const payload = items.map((item) => {
        const stagesInMonth = (item.workflowStages || []).filter((s) => {
          const d = s?.dueDate ? new Date(s.dueDate) : null;
          if (!d || Number.isNaN(d.getTime())) return false;
          return d >= startDate && d <= endDate;
        });

        return {
          contentItemId: item._id,
          title: item.title,
          planType: item.planType || item.plan || "normal",
          stages: dedupeByStageId(stagesInMonth).map((stage) => ({
            stageId: stage._id,
            stageName: stage.stageName,
            role: stage.role,
            assignedUser: stage.assignedUser || null,
            dueDate: toYMD(stage.dueDate),
            status: stage.status,
          })),
        };
      });

      return success(res, payload);
    } catch (err) {
      return failure(res, err.message || "Failed to fetch team calendar", 500);
    }
  },
  getManagerGlobalCalendar: async (req, res) => {
    try {
      const month = req.query.month;

      if (!normalizeMonthTarget(month)) {
        return failure(res, "month must be in format YYYY-MM", 400);
      }

      const clientDocs = await Client.find({ manager: req.user.id }).select(
        "_id clientName brandName"
      );

      const clientIds = clientDocs.map((c) => c._id);
      if (!clientIds.length) return success(res, { month, groups: [] });

      const contentItemsRaw = await ContentItem.find({ client: { $in: clientIds }, month })
        .populate("client", "clientName brandName")
        .sort({ clientPostingDate: 1 })
        .lean();
      const contentItems = dedupeById(contentItemsRaw);

      const groupsMap = new Map();
      for (const item of contentItems) {
        const key = item.clientPostingDate ? ymdUTC(new Date(item.clientPostingDate)) : "unknown";
        if (!groupsMap.has(key)) {
          groupsMap.set(key, {
            clientPostingDate: key,
            items: [],
          });
        }
        groupsMap.get(key).items.push(item);
      }

      const groups = [...groupsMap.values()]
        .map((g) => ({ ...g, items: dedupeById(g.items || []) }))
        .sort(
        (a, b) => new Date(a.clientPostingDate) - new Date(b.clientPostingDate)
      );

      return success(res, { month, groups });
    } catch (err) {
      return failure(res, err.message || "Failed to fetch global manager calendar", 500);
    }
  },
};

