const Client = require("../models/Client");
const Package = require("../models/Package");
const calendarService = require("../services/calendarService");
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
      // endDate is written by generateClientPackageOnce after ContentItems exist.
      status,
      googleReviewsTarget,
      googleReviewsAchieved,
      manager: req.user.id,
      package: packageId,
      team,
      createdBy: req.user.id,
    });

    await calendarService.generateClientPackageOnce(client);

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

      const items = await ContentItem.find({ client: id, month }).select(
        "_id title contentType plan clientPostingDate overallStatus"
      );

      return success(res, items.sort((a, b) => new Date(a.clientPostingDate) - new Date(b.clientPostingDate)));
    } catch (err) {
      return failure(res, err.message || "Failed to fetch client calendar", 500);
    }
  },
  getTeamCalendar: async (req, res) => {
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

      const items = await ContentItem.find({ client: id, month })
        .populate("workflowStages.assignedUser", "name avatar")
        .sort({ clientPostingDate: 1 });

      return success(res, items);
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

      const contentItems = await ContentItem.find({ client: { $in: clientIds }, month })
        .populate("client", "clientName brandName")
        .sort({ clientPostingDate: 1 })
        .lean();

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

      const groups = [...groupsMap.values()].sort(
        (a, b) => new Date(a.clientPostingDate) - new Date(b.clientPostingDate)
      );

      return success(res, { month, groups });
    } catch (err) {
      return failure(res, err.message || "Failed to fetch global manager calendar", 500);
    }
  },
};

