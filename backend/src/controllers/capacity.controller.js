const User = require("../models/User");
const UserCapacity = require("../models/UserCapacity");

const CAP_FIELDS = [
  "dailyReelEditCap",
  "dailyReelShootCap",
  "dailyDesignCap",
  "dailyPlanCap",
  "dailyPostCap",
  "dailyApproveCap",
  "dailyGeneralCap",
];

const DEFAULT_CAPS = CAP_FIELDS.reduce((acc, key) => {
  acc[key] = 7;
  return acc;
}, {});

const success = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

const failure = (res, error, statusCode = 400) =>
  res.status(statusCode).json({ success: false, error });

const buildDefaultPayload = (userId) => ({
  user: userId,
  ...DEFAULT_CAPS,
});

const getCapacity = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id).select("_id");
    if (!user) {
      return failure(res, "User not found", 404);
    }

    const doc = await UserCapacity.findOne({ user: id });
    if (!doc) {
      return success(res, buildDefaultPayload(id));
    }

    return success(res, doc);
  } catch (err) {
    return failure(res, err.message || "Failed to fetch capacity", 500);
  }
};

const setCapacity = async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body || {};

    const user = await User.findById(id).select("_id");
    if (!user) {
      return failure(res, "User not found", 404);
    }

    const updates = {};
    for (const key of CAP_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      const n = Number(body[key]);
      if (!Number.isFinite(n) || n < 0) {
        return failure(res, `${key} must be a non-negative number`, 400);
      }
      updates[key] = n;
    }

    if (Object.keys(updates).length === 0) {
      return failure(res, "No valid capacity fields to update", 400);
    }

    const doc = await UserCapacity.findOneAndUpdate(
      { user: id },
      { $set: updates, $setOnInsert: { user: id } },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    return success(res, doc);
  } catch (err) {
    return failure(res, err.message || "Failed to update capacity", 500);
  }
};

const capacityOverview = async (req, res) => {
  try {
    const users = await User.find({})
      .populate("role", "name slug color")
      .select("name email role isActive")
      .sort({ name: 1 })
      .lean();

    const caps = await UserCapacity.find({}).lean();
    const byUser = new Map(caps.map((c) => [String(c.user), c]));

    const rows = users.map((u) => {
      const existing = byUser.get(String(u._id));
      const capacity = existing
        ? { ...existing }
        : { ...buildDefaultPayload(u._id), _id: null };

      return {
        user: {
          _id: u._id,
          name: u.name,
          email: u.email,
          isActive: u.isActive,
          role: u.role,
        },
        capacity,
      };
    });

    return success(res, rows);
  } catch (err) {
    return failure(res, err.message || "Failed to fetch capacity overview", 500);
  }
};

module.exports = {
  getCapacity,
  setCapacity,
  capacityOverview,
};
