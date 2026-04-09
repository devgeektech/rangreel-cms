const Package = require("../models/Package");
const User = require("../models/User");
const Client = require("../models/Client");
const ContentItem = require("../models/ContentItem");
const Leave = require("../models/Leave");
const ClientScheduleDraft = require("../models/ClientScheduleDraft");
const { normalizeDraftItemToDurationTasks } = require("../services/taskNormalizer.service");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function normalizeMonthTarget(monthStr) {
  const m = String(monthStr || "").match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const monthIndex = Number(m[2]) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || monthIndex < 0 || monthIndex > 11) return null;
  return { year, monthIndex };
}

function toYMDUTC(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(x.getTime())) return "";
  return `${x.getUTCFullYear()}-${pad2(x.getUTCMonth() + 1)}-${pad2(x.getUTCDate())}`;
}

function normalizeUTCDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDaysUTC(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function clampToMonthRange(d, monthStart, monthEnd) {
  if (!d) return null;
  if (d.getTime() < monthStart.getTime()) return monthStart;
  if (d.getTime() > monthEnd.getTime()) return monthEnd;
  return d;
}

function buildDateRangeYMD(startDate, endDate) {
  const s = normalizeUTCDate(startDate);
  const e = normalizeUTCDate(endDate);
  if (!s || !e) return [];
  if (s.getTime() > e.getTime()) return [];
  const out = [];
  let cur = s;
  while (cur.getTime() <= e.getTime()) {
    out.push(toYMDUTC(cur));
    cur = addDaysUTC(cur, 1);
  }
  return out;
}

function isEditableRole(role) {
  const r = String(role || "");
  return r === "strategist" || r === "videographer" || r === "videoEditor" || r === "manager";
}

function roleToStageName(role) {
  const r = String(role || "");
  if (r === "strategist") return "Plan";
  if (r === "videographer") return "Shoot";
  if (r === "videoEditor") return "Edit";
  if (r === "graphicDesigner") return "Design";
  if (r === "manager") return "Approval";
  if (r === "postingExecutive") return "Post";
  return "Task";
}

const success = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

const failure = (res, error, statusCode = 400) =>
  res.status(statusCode).json({ success: false, error });

const getPackages = async (req, res) => {
  try {
    const uid = req.user.id;
    const packages = await Package.find({
      isActive: true,
      $or: [{ createdBy: uid }, { createdByRole: "admin" }, { createdBy: null }],
    })
      .populate("createdBy", "name")
      .sort({ createdAt: -1 })
      .lean();
    return success(res, packages);
  } catch (err) {
    return failure(res, "Failed to fetch packages", 500);
  }
};

/**
 * POST /api/manager/packages — manager-created package (same shape as admin; scoped to creator in GET list).
 */
const createManagerPackage = async (req, res) => {
  try {
    const {
      name,
      noOfReels,
      noOfStaticPosts,
      noOfCarousels,
      noOfGoogleReviews,
      gmbPosting,
      campaignManagement,
    } = req.body || {};

    const n = (v, fallback = 0) => {
      const x = Number(v);
      return Number.isFinite(x) ? Math.max(0, x) : fallback;
    };

    const nameStr = typeof name === "string" ? name.trim() : "";
    if (!nameStr) {
      return failure(res, "Package name is required", 400);
    }

    if (
      noOfReels === undefined ||
      noOfReels === null ||
      noOfStaticPosts === undefined ||
      noOfStaticPosts === null ||
      noOfCarousels === undefined ||
      noOfCarousels === null
    ) {
      return failure(res, "noOfReels, noOfStaticPosts, and noOfCarousels are required", 400);
    }

    const reels = n(noOfReels, 0);
    const staticPosts = n(noOfStaticPosts, 0);
    const carousels = n(noOfCarousels, 0);

    const packageDoc = await Package.create({
      name: nameStr,
      noOfReels: reels,
      noOfStaticPosts: staticPosts,
      noOfPosts: 0,
      noOfCarousels: carousels,
      noOfGoogleReviews: n(noOfGoogleReviews, 0),
      gmbPosting: Boolean(gmbPosting),
      campaignManagement: Boolean(campaignManagement),
      isActive: true,
      createdBy: req.user.id,
      createdByRole: req.user.roleType === "admin" ? "admin" : "manager",
    });

    const populated = await Package.findById(packageDoc._id).populate("createdBy", "name").lean();
    return success(res, populated, 201);
  } catch (err) {
    return failure(res, err.message || "Failed to create package", 500);
  }
};

const getTeamUsers = async (req, res) => {
  try {
    // Team members are non-system "user" accounts (strategist, editor, designer, etc).
    const users = await User.find({ roleType: "user" })
      .populate("role")
      .sort({ createdAt: -1 });

    const filtered = users.filter((u) => u.role && !u.role.isSystem);
    return success(res, filtered);
  } catch (err) {
    return failure(res, "Failed to fetch team users", 500);
  }
};

// PROMPT 83 — Global Calendar as single source for manager UI.
// GET /api/manager/global-calendar?month=YYYY-MM
// Returns: { month, clients, tasks, leaveBlocks }
const getManagerGlobalCalendarFinal = async (req, res) => {
  try {
    const month = req.query.month;
    const normalized = normalizeMonthTarget(month);
    if (!normalized) return failure(res, "month must be in format YYYY-MM", 400);
    const { year, monthIndex } = normalized;

    const monthStart = new Date(Date.UTC(year, monthIndex, 1));
    const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 0));

    const clientDocs = await Client.find({ manager: req.user.id })
      .select("_id clientName")
      .lean();

    const clientIds = (clientDocs || []).map((c) => c._id);
    if (!clientIds.length) {
      return success(res, { month, clients: [], tasks: [], leaveBlocks: [] });
    }

    // Source-of-truth: scheduler-computed draft tasks (not raw ContentItem stage rendering).
    const drafts = await ClientScheduleDraft.find({ clientId: { $in: clientIds } })
      .select("clientId items")
      .lean();

    const allContentIds = [];
    for (const d of drafts || []) {
      for (const it of d?.items || []) {
        if (it?.contentId) allContentIds.push(String(it.contentId));
      }
    }

    const contentItems = allContentIds.length
      ? await ContentItem.find({ _id: { $in: allContentIds } })
          .select("client contentType type planType plan title clientPostingDate")
          .lean()
      : [];

    const contentById = new Map((contentItems || []).map((c) => [String(c._id), c]));

    const clientNameById = new Map(
      (clientDocs || []).map((c) => [String(c._id), c.clientName || c.clientName])
    );

    const updatedTasks = [];
    let taskIdx = 0;
    for (const draft of drafts || []) {
      const clientIdStr = String(draft?.clientId || "");
      const clientName = clientNameById.get(clientIdStr) || "Client";
      for (const item of draft?.items || []) {
        const contentIdStr = String(item?.contentId || "");
        const meta = contentById.get(contentIdStr) || {};
        const planType = String(meta.planType || meta.plan || "normal").toLowerCase();
        const priority = planType === "urgent" ? "urgent" : "normal";

        const baseTasks =
          Array.isArray(item?.tasks) && item.tasks.length > 0
            ? item.tasks
            : normalizeDraftItemToDurationTasks(item);

        for (const t of baseTasks || []) {
          const role = String(t?.role || "");
          const start = String(t?.startDate || "");
          const end = String(t?.endDate || "");
          const perDay = t?.assignedUsersPerDay && typeof t.assignedUsersPerDay === "object"
            ? { ...t.assignedUsersPerDay }
            : {};
          const dates =
            Object.keys(perDay).length > 0
              ? Object.keys(perDay).sort()
              : buildDateRangeYMD(start, end);
          const clippedDates = (dates || []).filter((d) => d >= toYMDUTC(monthStart) && d <= toYMDUTC(monthEnd));
          if (!clippedDates.length) continue;
          const assignedUsers = [...new Set(Object.values(perDay || {}).filter(Boolean).map(String))];

          updatedTasks.push({
            taskId: String(t?.taskId || `${contentIdStr}::${role}::${start || "na"}::${taskIdx++}`),
            contentItemId: contentIdStr,
            clientId: clientIdStr,
            clientName,
            title: meta.title || "",
            contentType: String(meta.contentType || meta.type || item?.type || ""),
            role,
            stageName: roleToStageName(role),
            stageId: "",
            status: "assigned",
            planType,
            priority,
            startDate: start,
            endDate: end,
            finalDate: end,
            durationDays: Number(t?.durationDays || clippedDates.length || 1),
            finalDuration: Number(t?.durationDays || clippedDates.length || 1),
            dates: clippedDates,
            assignedUsers,
            assignedUsersPerDay: perDay,
            isEditable: isEditableRole(role),
          });
        }
      }
    }

    // Leave highlights: prefetch leaves for all task assigned users overlapping month.
    const allAssignedUserIds = new Set();
    for (const t of updatedTasks) {
      for (const uid of Object.values(t.assignedUsersPerDay || {})) {
        if (!uid) continue;
        allAssignedUserIds.add(uid);
      }
    }
    const userIds = [...allAssignedUserIds];

    const leaveDocs = userIds.length
      ? await Leave.find({
          userId: { $in: userIds },
          startDate: { $lte: monthEnd },
          endDate: { $gte: monthStart },
        }).lean()
      : [];

    const leaveBlocks = (leaveDocs || []).map((doc) => ({
      userId: doc.userId && doc.userId._id ? String(doc.userId._id) : String(doc.userId || ""),
      startDate: doc.startDate,
      endDate: doc.endDate,
    }));

    const leaveYmdByUser = new Map();
    for (const doc of leaveDocs || []) {
      const uidStr = doc.userId && doc.userId._id ? String(doc.userId._id) : doc.userId ? String(doc.userId) : "";
      if (!uidStr) continue;
      if (!leaveYmdByUser.has(uidStr)) leaveYmdByUser.set(uidStr, new Set());
      const set = leaveYmdByUser.get(uidStr);

      const from = normalizeUTCDate(doc.startDate);
      const to = normalizeUTCDate(doc.endDate);
      if (!from || !to) continue;

      const clippedFrom = clampToMonthRange(from, monthStart, monthEnd);
      const clippedTo = clampToMonthRange(to, monthStart, monthEnd);
      if (!clippedFrom || !clippedTo) continue;

      let cur = clippedFrom;
      while (cur.getTime() <= clippedTo.getTime()) {
        set.add(toYMDUTC(cur));
        cur = addDaysUTC(cur, 1);
      }
    }

    // Finalize leaveDates per task.
    for (const t of updatedTasks) {
      const leaveDates = [];
      for (const d of t.dates || []) {
        const uid = t.assignedUsersPerDay && t.assignedUsersPerDay[d] ? String(t.assignedUsersPerDay[d]) : "";
        if (!uid) continue;
        const set = leaveYmdByUser.get(uid);
        if (set && set.has(d)) leaveDates.push(d);
      }
      t.leaveHighlights = leaveDates;
    }

    const clients = (clientDocs || []).map((c) => ({
      _id: String(c._id),
      clientName: c.clientName || "Client",
    }));

    return success(res, { month, clients, updatedTasks, tasks: updatedTasks, leaveBlocks });
  } catch (err) {
    return failure(res, err.message || "Failed to fetch global manager calendar", 500);
  }
};

module.exports = {
  getPackages,
  createManagerPackage,
  getTeamUsers,
  getManagerGlobalCalendarFinal,
};

