const TeamCapacity = require("../models/TeamCapacity");
const TEAM_ROLES = TeamCapacity.TEAM_ROLES;

const success = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

const failure = (res, error, statusCode = 400) =>
  res.status(statusCode).json({ success: false, error });

const listTeamCapacity = async (req, res) => {
  try {
    const docs = await TeamCapacity.find({}).sort({ role: 1 }).lean();
    const byRole = new Map(docs.map((d) => [d.role, d]));
    const data = TEAM_ROLES.map((role) => {
      const d = byRole.get(role);
      if (!d) {
        return { role, dailyCapacity: null };
      }
      return {
        role: d.role,
        dailyCapacity: d.dailyCapacity,
        updatedAt: d.updatedAt,
      };
    });
    return success(res, data);
  } catch (err) {
    return failure(res, err.message || "Failed to load team capacity", 500);
  }
};

const patchTeamCapacity = async (req, res) => {
  try {
    const { role } = req.params;
    const { dailyCapacity } = req.body || {};

    if (!role || !TEAM_ROLES.includes(role)) {
      return failure(res, "Invalid or unknown role", 400);
    }
    if (dailyCapacity === undefined || dailyCapacity === null) {
      return failure(res, "dailyCapacity is required", 400);
    }
    const n = Number(dailyCapacity);
    if (!Number.isFinite(n) || n < 0) {
      return failure(res, "dailyCapacity must be a non-negative number", 400);
    }

    const doc = await TeamCapacity.findOneAndUpdate(
      { role },
      { $set: { role, dailyCapacity: n } },
      { upsert: true, new: true, runValidators: true }
    ).lean();

    return success(res, {
      role: doc.role,
      dailyCapacity: doc.dailyCapacity,
      updatedAt: doc.updatedAt,
    });
  } catch (err) {
    return failure(res, err.message || "Failed to update team capacity", 500);
  }
};

module.exports = {
  listTeamCapacity,
  patchTeamCapacity,
};
