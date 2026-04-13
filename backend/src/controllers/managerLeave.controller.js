const mongoose = require("mongoose");
const User = require("../models/User");
const Leave = require("../models/Leave");
const ContentItem = require("../models/ContentItem");

function addDaysUTC(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function normalizeUserLeaveRange(startDate, endDate) {
  const start = normalizeDateToUtcMidnight(startDate);
  const end = normalizeDateToUtcMidnight(endDate);
  if (!start || !end) return null;
  if (start.getTime() > end.getTime()) return null;
  return { start, end };
}

// PROMPT 74 — Manager add leave with simulation.
// POST /api/manager/leave
// Body: { userId, startDate, endDate, reason }
const createLeaveSimulatedConflict = async (req, res) => {
  try {
    const { userId, startDate, endDate, reason } = req.body || {};
    if (!userId) return failure(res, "userId is required", 400);
    if (!startDate || !endDate) return failure(res, "startDate and endDate are required", 400);

    const normalizedRange = normalizeUserLeaveRange(startDate, endDate);
    if (!normalizedRange) return failure(res, "Invalid date range", 400);
    const { start, end } = normalizedRange;

    // Prevent overlapping leave for the same user.
    const overlap = await Leave.findOne({
      userId,
      startDate: { $lte: end },
      endDate: { $gte: start },
    }).lean();

    if (overlap) {
      return res.status(409).json({
        success: false,
        error: "Leave causes scheduling conflict",
      });
    }

    const endExclusive = addDaysUTC(end, 1);
    const nonBlockingStatuses = ["completed", "posted", "approved", "submitted", "rejected"];
    const blockingItem = await ContentItem.findOne({
      workflowStages: {
        $elemMatch: {
          assignedUser: userId,
          dueDate: { $gte: start, $lt: endExclusive },
          status: { $nin: nonBlockingStatuses },
        },
      },
    })
      .select("_id workflowStages")
      .lean();

    if (blockingItem) {
      const conflictingStage = (blockingItem.workflowStages || []).find((stage) => {
        if (!stage) return false;
        if (String(stage?.assignedUser || "") !== String(userId)) return false;
        const due = stage?.dueDate ? new Date(stage.dueDate) : null;
        if (!due || Number.isNaN(due.getTime())) return false;
        if (!(due >= start && due < endExclusive)) return false;
        const st = String(stage?.status || "").toLowerCase();
        return !nonBlockingStatuses.includes(st);
      });
      return res.status(409).json({
        success: false,
        reason: "Leave causes global scheduling conflict",
        details: conflictingStage
          ? {
              conflict: {
                userId: String(userId),
                date: conflictingStage.dueDate,
                stageName: conflictingStage.stageName || "",
                role: conflictingStage.role || "",
                status: conflictingStage.status || "",
                contentItemId: String(blockingItem._id || ""),
              },
            }
          : undefined,
      });
    }

    const createdByRole = req.user?.roleType === "admin" ? "admin" : "manager";
    const leave = await Leave.create({
      userId,
      startDate: start,
      endDate: end,
      reason: reason ? String(reason).trim() : "",
      createdBy: req.user.id,
      createdByRole,
    });

    return success(res, leave, 201);
  } catch (err) {
    return failure(res, err.message || "Failed to create leave", 500);
  }
};

const success = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

const failure = (res, error, statusCode = 400) =>
  res.status(statusCode).json({ success: false, error });

function normalizeDateToUtcMidnight(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// Manager-controlled leave creation (Prompt 71)
// Body: { userId, date } OR { userId, from, to, reason? }
const createLeave = async (req, res) => {
  try {
    const { userId, date, from, to, reason } = req.body || {};
    if (!userId) return failure(res, "userId is required", 400);
    if (!date && (!from || !to)) return failure(res, "Provide date or from+to", 400);

    const normalizedFrom = normalizeDateToUtcMidnight(date || from);
    const normalizedTo = normalizeDateToUtcMidnight(date || to);
    if (!normalizedFrom || !normalizedTo) return failure(res, "Invalid leave date(s)", 400);
    if (normalizedFrom.getTime() > normalizedTo.getTime()) {
      return failure(res, "`from` cannot be after `to`", 400);
    }

    const user = await User.findById(userId).select("_id roleType").lean();
    if (!user) return failure(res, "User not found", 404);

    const createdByRole =
      req.user?.roleType === "admin" ? "admin" : "manager";

    const leave = await Leave.create({
      userId: user._id,
      startDate: normalizedFrom,
      endDate: normalizedTo,
      reason: reason ? String(reason).trim() : "",
      createdBy: req.user.id,
      createdByRole,
    });

    return success(res, leave, 201);
  } catch (err) {
    return failure(res, err.message || "Failed to create leave", 500);
  }
};

const listLeaves = async (req, res) => {
  try {
    const { from, to } = req.query || {};
    const normalizedFrom = normalizeDateToUtcMidnight(from);
    const normalizedTo = normalizeDateToUtcMidnight(to);

    const q = {};
    if (normalizedFrom && normalizedTo) {
      // Overlap: leave range intersects [from,to]
      q.startDate = { $lte: normalizedTo };
      q.endDate = { $gte: normalizedFrom };
    }

    const leaves = await Leave.find(q).sort({ startDate: 1 }).lean();
    return success(res, leaves);
  } catch (err) {
    return failure(res, err.message || "Failed to list leaves", 500);
  }
};

// PROMPT 75 — GET leave for UI/calendar display.
// GET /api/manager/leave?userId=optional
// Returns: [{ userId, startDate, endDate, reason }]
const getLeaves = async (req, res) => {
  try {
    const { userId } = req.query || {};

    if (userId && !mongoose.Types.ObjectId.isValid(String(userId))) {
      return failure(res, "Invalid userId", 400);
    }

    const query = userId ? { userId: userId } : {};

    const leaves = await Leave.find(query)
      .select("userId startDate endDate reason")
      .lean();

    const normalized = (leaves || []).map((l) => ({
      leaveId: String(l._id),
      userId: String(l.userId),
      startDate: l.startDate,
      endDate: l.endDate,
      reason: l.reason || "",
    }));

    return success(res, normalized);
  } catch (err) {
    return failure(res, err.message || "Failed to fetch leaves", 500);
  }
};

// PROMPT 76 — DELETE LEAVE
// DELETE /api/manager/leave/:leaveId
const deleteLeave = async (req, res) => {
  try {
    const { leaveId } = req.params || {};
    if (!leaveId) return failure(res, "leaveId is required", 400);
    if (!mongoose.Types.ObjectId.isValid(String(leaveId))) {
      return failure(res, "Invalid leaveId", 400);
    }

    const deleted = await Leave.findByIdAndDelete(leaveId).lean();
    if (!deleted) return failure(res, "Leave not found", 404);

    return success(res, { deletedLeaveId: String(leaveId) });
  } catch (err) {
    return failure(res, err.message || "Failed to delete leave", 500);
  }
};

module.exports = {
  createLeave,
  createLeaveSimulatedConflict,
  listLeaves,
  getLeaves,
  deleteLeave,
};

