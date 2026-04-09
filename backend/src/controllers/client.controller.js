const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const Client = require("../models/Client");
const Package = require("../models/Package");
const { uploadsRoot, BRIEF_UPLOAD_FIELDS } = require("../multer/clientBriefUpload");
const { generateClientReels } = require("../services/simpleCalendar.service");
const { persistCalendarDraft } = require("../services/calendarDraftPersistence.service");
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

/** Client JSON must not set uploaded file metadata; use POST …/brief-assets. */
const stripNonPatchableBriefKeys = (raw) => {
  if (!raw || typeof raw !== "object") return {};
  const {
    brandKitFiles: _bk,
    socialCredentialsFiles: _sc,
    otherBriefFiles: _ob,
    agreementFiles: _ag,
    ...rest
  } = raw;
  return rest;
};

function validateStages(stages) {
  const utcYmd = (v) => {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  };
  for (let i = 0; i < stages.length - 1; i++) {
    const a = stages[i]?.dueDate || stages[i]?.date;
    const b = stages[i + 1]?.dueDate || stages[i + 1]?.date;
    const da = new Date(a);
    const db = new Date(b);
    if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) continue;
    // Same calendar day is valid (e.g. urgent Edit + Approval, or manager same-day as edit).
    if (utcYmd(da) === utcYmd(db)) continue;
    if (da > db) {
      throw new Error("Invalid stage order");
    }
  }
}

function validatePhaseOrderByName(stages) {
  const order = ["Plan", "Shoot", "Edit", "Approval", "Post"];
  const pos = new Map(order.map((n, i) => [n, i]));
  const names = (stages || []).map((s) => s?.name || s?.stageName).filter(Boolean);
  // Require all known stages in correct order when present.
  for (let i = 0; i < names.length; i++) {
    const a = pos.get(String(names[i]));
    if (a == null) continue;
    for (let j = i + 1; j < names.length; j++) {
      const b = pos.get(String(names[j]));
      if (b == null) continue;
      if (a >= b) throw new Error("Invalid stage order");
      break;
    }
  }
  const last = names[names.length - 1];
  if (last && String(last) !== "Post") {
    // Not always enforced for all templates, but Phase 12 requires Post as last.
    throw new Error("Invalid stage order");
  }
}

function normalizeCustomStageRows(stages) {
  return (stages || []).map((s) => ({
    name: s?.name || s?.stageName || "",
    stageName: s?.stageName || s?.name || "",
    role: s?.role,
    assignedUser: s?.assignedUser || undefined,
    date: s?.date || s?.dueDate,
    dueDate: s?.dueDate || s?.date,
    status: s?.status || "assigned",
  }));
}

function findBriefFileRecord(client, fileId) {
  if (!mongoose.Types.ObjectId.isValid(fileId)) return null;
  for (const { arrayKey, slug } of BRIEF_UPLOAD_FIELDS) {
    const arr = client.clientBrief?.[arrayKey];
    if (!Array.isArray(arr) || typeof arr.id !== "function") continue;
    const doc = arr.id(fileId);
    if (doc) return { doc, slug, arrayKey };
  }
  return null;
}

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
  postsCount: (Number(pkg?.noOfPosts) || 0) + (Number(pkg?.noOfStaticPosts) || 0),
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

const { normalizeDraftItemToDurationTasks } = require("../services/taskNormalizer.service");

const toDraftItems = (contentItems) => {
  return (contentItems || []).map((item) => {
    const draftItem = {
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
    };
    return {
      ...draftItem,
      tasks: normalizeDraftItemToDurationTasks(draftItem),
    };
  });
};

const createClient = async (req, res) => {
  try {
    const {
      clientName,
      brandName,
      contactNumber,
      email,
      website,
      industry,
      businessType,
      socialHandles,
      socialCredentialsNotes,
      clientBrief,
      startDate,
      status,
      package: packageId,
      team,
      googleReviewsTarget: bodyReviewsTarget,
      googleReviewsAchieved: bodyReviewsAchieved,
      contentEnabled,
      calendarDraft,
      customStages,
      isCustomCalendar,
      weekendEnabled,
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
      contactNumber: contactNumber ?? "",
      email: email ?? "",
      website: website ?? "",
      industry,
      businessType,
      socialHandles: socialHandles || {},
      socialCredentialsNotes: socialCredentialsNotes ?? "",
      clientBrief:
        clientBrief && typeof clientBrief === "object"
          ? stripNonPatchableBriefKeys(clientBrief)
          : {},
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
      isCustomCalendar: isCustomCalendar || false,
      weekendEnabled: weekendEnabled || false,
      createdBy: req.user.id,
    });

    const hasCalendarDraft =
      calendarDraft?.items && Array.isArray(calendarDraft.items) && calendarDraft.items.length > 0;
    const hasCustomStages = Array.isArray(customStages) && customStages.length > 0;

    // Auto generation unless pre-creation customization payload is provided.
    if (hasCalendarDraft || hasCustomStages) {
      let draftToPersist = hasCalendarDraft ? { ...calendarDraft } : { items: [] };

      if (hasCustomStages) {
        const looksLikeFullDraftItems = customStages.every(
          (row) => Array.isArray(row?.stages) && row?.type && row?.postingDate
        );

        if (!hasCalendarDraft && !looksLikeFullDraftItems) {
          return failure(
            res,
            "customStages requires calendarDraft.items or full item payload (type, postingDate, stages)",
            400
          );
        }

        if (!hasCalendarDraft && looksLikeFullDraftItems) {
          const builtItems = customStages.map((row, idx) => {
            const normalizedStages = normalizeCustomStageRows(row.stages || []);
            validateStages(normalizedStages);
            validatePhaseOrderByName(normalizedStages);
            const item = {
              contentId: row.contentItemId || row.contentId || `custom-${idx + 1}`,
              type: row.type,
              title: row.title || row.contentItemId || `Item ${idx + 1}`,
              postingDate: row.postingDate,
              isLocked: true,
              stages: normalizedStages,
            };
            return {
              ...item,
              tasks: normalizeDraftItemToDurationTasks(item),
            };
          });
          draftToPersist = { items: builtItems };
        } else {
          const nextItems = (draftToPersist.items || []).map((it) => ({ ...it }));
          for (const row of customStages) {
            const key = String(row?.contentItemId || row?.contentId || "");
            if (!key) continue;
            const idx = nextItems.findIndex((it) => String(it.contentId) === key);
            if (idx === -1) continue;
            if (!Array.isArray(row.stages) || row.stages.length === 0) continue;
            const normalizedStages = normalizeCustomStageRows(row.stages);
            validateStages(normalizedStages);
            validatePhaseOrderByName(normalizedStages);
            const merged = { ...nextItems[idx], stages: normalizedStages };
            merged.tasks = normalizeDraftItemToDurationTasks(merged);
            nextItems[idx] = merged;
          }
          draftToPersist = { ...draftToPersist, items: nextItems };
        }
      }

      const { endDate } = await persistCalendarDraft({
        clientId: client._id,
        calendarDraft: draftToPersist,
        createdBy: req.user.id,
      });
      if (endDate) {
        await Client.updateOne({ _id: client._id }, { $set: { endDate } });
      }
    } else {
      // Prompt 16: only run the new simple calendar service.
      // New clients: weekdays + public holidays only (no Sat/Sun) unless a pre-built draft is supplied above.
      await generateClientReels(client, {
        allowWeekend: false,
        allowFlexibleAdjustment: false,
      });
    }

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

    const contentItems = await ContentItem.find({ client: id })
      .select("title type contentType clientPostingDate workflowStages month planType")
      .sort({ clientPostingDate: 1 })
      .lean();

    const clientObj = client.toObject ? client.toObject() : client;
    clientObj.contentItems = (contentItems || []).map((item) => ({
      _id: item._id,
      title: item.title,
      type: item.type,
      contentType: item.contentType,
      postingDate: toYMD(item.clientPostingDate),
      month: item.month,
      planType: item.planType || "normal",
      stages: (item.workflowStages || []).map((s) => ({
        stageName: s.stageName,
        dueDate: toYMD(s.dueDate),
        role: s.role,
        status: s.status,
        assignedUser: s.assignedUser || null,
      })),
    }));

    return success(res, clientObj);
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
      "contactNumber",
      "email",
      "website",
      "industry",
      "businessType",
      "socialHandles",
      "socialCredentialsNotes",
      "startDate",
      "status",
    ];

    allowedFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(rest, field)) {
        client[field] = rest[field];
      }
    });

    if (rest.clientBrief && typeof rest.clientBrief === "object") {
      const cleaned = stripNonPatchableBriefKeys(rest.clientBrief);
      client.clientBrief = {
        ...(client.clientBrief?.toObject ? client.clientBrief.toObject() : client.clientBrief),
        ...cleaned,
      };
      client.markModified("clientBrief");
    }

    await client.save();

    const populated = await populateClientQuery(Client.findById(client._id));
    return success(res, populated);
  } catch (err) {
    return failure(res, err.message || "Failed to update client", 500);
  }
};

const appendClientBriefAssets = async (req, res) => {
  try {
    const { id } = req.params;
    const client = await Client.findOne({ _id: id, manager: req.user.id });
    if (!client) {
      return failure(res, "Client not found", 404);
    }

    const uploaded = req.files || {};
    let added = 0;
    for (const { arrayKey } of BRIEF_UPLOAD_FIELDS) {
      if (!Array.isArray(client.clientBrief[arrayKey])) {
        client.clientBrief[arrayKey] = [];
      }
    }
    for (const { field, arrayKey } of BRIEF_UPLOAD_FIELDS) {
      const list = uploaded[field];
      if (!list?.length) continue;
      for (const f of list) {
        client.clientBrief[arrayKey].push({
          storedName: f.filename,
          originalName: f.originalname,
          mimeType: f.mimetype,
          size: f.size,
          uploadedAt: new Date(),
        });
        added += 1;
      }
    }

    if (added === 0) {
      return failure(
        res,
        "No files received. Use fields brandKit, socialCredentials, other, or agreement.",
        400
      );
    }

    client.markModified("clientBrief");
    await client.save();

    const populated = await populateClientQuery(Client.findById(client._id));
    return success(res, populated);
  } catch (err) {
    return failure(res, err.message || "Failed to save uploads", 500);
  }
};

const downloadClientBriefAsset = async (req, res) => {
  try {
    const { id, fileId } = req.params;
    const client = await Client.findOne({ _id: id, manager: req.user.id });
    if (!client) {
      return failure(res, "Client not found", 404);
    }

    const found = findBriefFileRecord(client, fileId);
    if (!found) {
      return failure(res, "File not found", 404);
    }

    const { doc, slug } = found;
    const abs = path.join(
      uploadsRoot,
      "clients",
      String(id),
      "brief",
      slug,
      doc.storedName
    );

    if (!fs.existsSync(abs)) {
      return failure(res, "File missing on server", 404);
    }

    const asciiName = String(doc.originalName || doc.storedName).replace(/[^\x20-\x7E]/g, "_");
    res.setHeader("Content-Type", doc.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${asciiName}"`);

    const stream = fs.createReadStream(abs);
    stream.on("error", () => {
      if (!res.headersSent) failure(res, "Failed to read file", 500);
    });
    stream.pipe(res);
  } catch (err) {
    return failure(res, err.message || "Failed to download file", 500);
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
  appendClientBriefAssets,
  downloadClientBriefAsset,
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

