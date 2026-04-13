const TeamCapacity = require("../models/TeamCapacity");
const { TEAM_ROLES } = TeamCapacity;
const { ROLE_CAPACITY_MAP } = require("../constants/roleCapacityMap");

const success = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

const failure = (res, error, statusCode = 400) =>
  res.status(statusCode).json({ success: false, error });

function validateTeamCapacityBody(role, body) {
  const allowedTypes = ROLE_CAPACITY_MAP[role];
  if (!allowedTypes) {
    throw new Error("Invalid role for team capacity");
  }
  const reelCapacity = body.reelCapacity !== undefined ? Number(body.reelCapacity) : undefined;
  const postCapacity = body.postCapacity !== undefined ? Number(body.postCapacity) : undefined;
  const carouselCapacity =
    body.carouselCapacity !== undefined ? Number(body.carouselCapacity) : undefined;

  const updates = {};
  if (reelCapacity !== undefined) {
    if (!Number.isFinite(reelCapacity) || reelCapacity < 0) {
      throw new Error("reelCapacity must be a non-negative number");
    }
    if (!allowedTypes.includes("reel") && reelCapacity > 0) {
      throw new Error("This role cannot have reel capacity");
    }
    updates.reelCapacity = reelCapacity;
  }
  if (postCapacity !== undefined) {
    if (!Number.isFinite(postCapacity) || postCapacity < 0) {
      throw new Error("postCapacity must be a non-negative number");
    }
    if (!allowedTypes.includes("static_post") && postCapacity > 0) {
      throw new Error("This role cannot have post capacity");
    }
    updates.postCapacity = postCapacity;
  }
  if (carouselCapacity !== undefined) {
    if (!Number.isFinite(carouselCapacity) || carouselCapacity < 0) {
      throw new Error("carouselCapacity must be a non-negative number");
    }
    if (!allowedTypes.includes("carousel") && carouselCapacity > 0) {
      throw new Error("This role cannot have carousel capacity");
    }
    updates.carouselCapacity = carouselCapacity;
  }
  return updates;
}

const listTeamCapacity = async (req, res) => {
  try {
    const docs = await TeamCapacity.find({}).sort({ role: 1 }).lean();
    const byRole = new Map(docs.map((d) => [d.role, d]));
    const data = TEAM_ROLES.map((role) => {
      const d = byRole.get(role);
      if (!d) {
        return {
          role,
          reelCapacity: null,
          postCapacity: null,
          carouselCapacity: null,
        };
      }
      return {
        role: d.role,
        reelCapacity: d.reelCapacity,
        postCapacity: d.postCapacity,
        carouselCapacity: d.carouselCapacity,
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
    const body = req.body || {};

    if (!role || !TEAM_ROLES.includes(role)) {
      return failure(res, "Invalid or unknown role", 400);
    }

    const updates = validateTeamCapacityBody(role, body);
    if (Object.keys(updates).length === 0) {
      return failure(
        res,
        "Provide at least one of reelCapacity, postCapacity, carouselCapacity",
        400
      );
    }

    const doc = await TeamCapacity.findOneAndUpdate(
      { role },
      { $set: { role, ...updates } },
      { upsert: true, new: true, runValidators: true }
    ).lean();

    return success(res, {
      role: doc.role,
      reelCapacity: doc.reelCapacity,
      postCapacity: doc.postCapacity,
      carouselCapacity: doc.carouselCapacity,
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
