const User = require("../models/User");
const UserCapacity = require("../models/UserCapacity");
const {
  ROLE_CAPACITY_MAP,
  resolveWorkflowRoleFromUserRoleSlug,
} = require("../constants/roleCapacityMap");

const CAP_FIELDS = ["reelCapacity", "postCapacity", "carouselCapacity"];

const success = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

const failure = (res, error, statusCode = 400) =>
  res.status(statusCode).json({ success: false, error });

function validateUserCapacityBody(workflowRole, body) {
  const allowedTypes = ROLE_CAPACITY_MAP[workflowRole];
  if (!allowedTypes) {
    throw new Error("User role does not support capacity overrides");
  }
  const updates = {};
  for (const key of CAP_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    const n = Number(body[key]);
    if (!Number.isFinite(n) || n < 0) {
      throw new Error(`${key} must be a non-negative number`);
    }
    if (key === "reelCapacity" && !allowedTypes.includes("reel") && n > 0) {
      throw new Error("This role cannot have reel capacity");
    }
    if (key === "postCapacity" && !allowedTypes.includes("static_post") && n > 0) {
      throw new Error("This role cannot have post capacity");
    }
    if (key === "carouselCapacity" && !allowedTypes.includes("carousel") && n > 0) {
      throw new Error("This role cannot have carousel capacity");
    }
    updates[key] = n;
  }
  return updates;
}

const getCapacity = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id).populate("role", "slug").select("_id").lean();
    if (!user) {
      return failure(res, "User not found", 404);
    }

    const workflowRole = resolveWorkflowRoleFromUserRoleSlug(user.role?.slug);
    if (!workflowRole) {
      return failure(res, "User role does not have schedulable capacity", 400);
    }

    const doc = await UserCapacity.findOne({ user: id }).lean();
    if (!doc) {
      return success(res, {
        user: id,
        role: workflowRole,
        reelCapacity: 0,
        postCapacity: 0,
        carouselCapacity: 0,
      });
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

    const user = await User.findById(id).populate("role", "slug").select("_id").lean();
    if (!user) {
      return failure(res, "User not found", 404);
    }

    const workflowRole = resolveWorkflowRoleFromUserRoleSlug(user.role?.slug);
    if (!workflowRole) {
      return failure(res, "User role does not have schedulable capacity", 400);
    }

    const updates = validateUserCapacityBody(workflowRole, body);

    if (Object.keys(updates).length === 0) {
      return failure(res, "No valid capacity fields to update", 400);
    }

    const doc = await UserCapacity.findOneAndUpdate(
      { user: id },
      { $set: { ...updates, role: workflowRole }, $setOnInsert: { user: id } },
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
      const workflowRole = resolveWorkflowRoleFromUserRoleSlug(u.role?.slug);
      const existing = byUser.get(String(u._id));
      const capacity = existing
        ? { ...existing }
        : {
            user: u._id,
            role: workflowRole || "strategist",
            reelCapacity: 0,
            postCapacity: 0,
            carouselCapacity: 0,
            _id: null,
          };

      return {
        user: {
          _id: u._id,
          name: u.name,
          email: u.email,
          isActive: u.isActive,
          role: u.role,
        },
        workflowRole,
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
