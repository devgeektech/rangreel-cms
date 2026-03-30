const Client = require("../models/Client");
const Package = require("../models/Package");
const { generateClientReels } = require("../services/simpleCalendar.service");
const ContentItem = require("../models/ContentItem");
const ClientScheduleDraft = require("../models/ClientScheduleDraft");

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
    .populate("team.reels.strategist")
    .populate("team.reels.videographer")
    .populate("team.reels.videoEditor")
    .populate("team.reels.manager")
    .populate("team.reels.postingExecutive")
    .populate("team.posts.strategist")
    .populate("team.posts.graphicDesigner")
    .populate("team.posts.manager")
    .populate("team.posts.postingExecutive")
    .populate("team.carousel.strategist")
    .populate("team.carousel.graphicDesigner")
    .populate("team.carousel.manager")
    .populate("team.carousel.postingExecutive");
};

const hasValue = (v) => v !== undefined && v !== null && String(v).trim() !== "";

const REEL_ROLE_KEYS = ["strategist", "videographer", "videoEditor", "manager", "postingExecutive"];
const POST_ROLE_KEYS = ["strategist", "graphicDesigner", "manager", "postingExecutive"];

const groupAnyFilled = (group, keys) => keys.some((k) => hasValue(group?.[k]));
const groupAllFilled = (group, keys) => keys.every((k) => hasValue(group?.[k]));

const packageCounts = (pkg) => ({
  reelsCount: Number(pkg?.noOfReels) || 0,
  postsCount: Number(pkg?.noOfPosts ?? pkg?.noOfStaticPosts) || 0,
  carouselsCount: Number(pkg?.noOfCarousels) || 0,
});

/** contentEnabled false = do not schedule this type for the client (even if the package includes it). */
const effectiveContentCounts = (pkg, contentEnabled = {}) => {
  const caps = packageCounts(pkg);
  return {
    reelsCount: contentEnabled.reels === false ? 0 : caps.reelsCount,
    postsCount: contentEnabled.posts === false ? 0 : caps.postsCount,
    carouselsCount: contentEnabled.carousel === false ? 0 : caps.carouselsCount,
  };
};

/**
 * Teams must be complete for each content type that is scheduled for this client (effective counts > 0).
 * Types not scheduled must have empty team rows.
 */
const validateTeamForPackage = (team, effective) => {
  const { reelsCount, postsCount, carouselsCount } = effective;
  const reels = team?.reels || {};
  const posts = team?.posts || {};
  const carousel = team?.carousel || {};

  if (reelsCount > 0) {
    if (!groupAllFilled(reels, REEL_ROLE_KEYS)) {
      return "Reels are scheduled for this client — assign every role in the reels team";
    }
  } else if (groupAnyFilled(reels, REEL_ROLE_KEYS)) {
    return "Reels are not scheduled for this client — leave the reels team empty";
  }

  if (postsCount > 0) {
    if (!groupAllFilled(posts, POST_ROLE_KEYS)) {
      return "Static content is scheduled — assign every role in the static team";
    }
  } else if (groupAnyFilled(posts, POST_ROLE_KEYS)) {
    return "Static is not scheduled for this client — leave the static team empty";
  }

  if (carouselsCount > 0) {
    if (!groupAllFilled(carousel, POST_ROLE_KEYS)) {
      return "Carousels are scheduled — assign every role in the carousel team";
    }
  } else if (groupAnyFilled(carousel, POST_ROLE_KEYS)) {
    return "Carousels are not scheduled for this client — leave the carousel team empty";
  }

  return null;
};

const pickTeamSubsetForPackage = (team, effective) => {
  const { reelsCount, postsCount, carouselsCount } = effective;
  const out = {};
  if (reelsCount > 0) out.reels = team?.reels;
  if (postsCount > 0) out.posts = team?.posts;
  if (carouselsCount > 0) out.carousel = team?.carousel;
  return out;
};

const toDraftType = (item) => {
  const t = String(item?.type || "").toLowerCase();
  if (t === "reel" || t === "post" || t === "carousel") return t;
  const ct = String(item?.contentType || "").toLowerCase();
  if (ct === "carousel") return "carousel";
  if (ct === "static_post" || ct === "post") return "post";
  return "reel";
};

const toDraftItems = (contentItems) => {
  return (contentItems || []).map((item) => ({
    contentId: item._id,
    type: toDraftType(item),
    stages: (item.workflowStages || []).map((stage) => ({
      name: stage.stageName,
      role: stage.role,
      assignedUser: stage.assignedUser,
      date: stage.dueDate,
      status: stage.status || "assigned",
    })),
    postingDate: item.clientPostingDate,
    isLocked: true,
  }));
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
      contentEnabled,
    } = req.body;

    if (!packageId) {
      return failure(res, "package is required", 400);
    }

    const pkg = await Package.findById(packageId)
      .select("noOfGoogleReviews noOfReels noOfPosts noOfStaticPosts noOfCarousels")
      .lean();
    if (!pkg) {
      return failure(res, "Package not found", 400);
    }

    const effective = effectiveContentCounts(pkg, contentEnabled || {});
    if (
      effective.reelsCount + effective.postsCount + effective.carouselsCount === 0 &&
      packageCounts(pkg).reelsCount + packageCounts(pkg).postsCount + packageCounts(pkg).carouselsCount > 0
    ) {
      return failure(
        res,
        "Turn on at least one content type (reels, static, or carousels) for this client",
        400
      );
    }
    const teamError = validateTeamForPackage(team, effective);
    if (teamError) {
      return failure(res, teamError, 400);
    }

    const teamToSave = pickTeamSubsetForPackage(team, effective);
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
      team: teamToSave,
      activeContentCounts: {
        noOfReels: effective.reelsCount,
        noOfStaticPosts: effective.postsCount,
        noOfCarousels: effective.carouselsCount,
      },
      createdBy: req.user.id,
    });

    // Prompt 16: only run the new simple calendar service.
    await generateClientReels(client);

    // Prompt 68: keep an editable draft copy in sync with generated ContentItems.
    const generatedItems = await ContentItem.find({ client: client._id })
      .select("_id type contentType workflowStages clientPostingDate")
      .sort({ clientPostingDate: 1 })
      .lean();

    await ClientScheduleDraft.findOneAndUpdate(
      { clientId: client._id },
      {
        $set: {
          clientId: client._id,
          items: toDraftItems(generatedItems),
        },
      },
      { upsert: true, new: true, runValidators: true }
    );

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

