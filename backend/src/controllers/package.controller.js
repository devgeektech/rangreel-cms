const Package = require("../models/Package");
const Client = require("../models/Client");
const { calculatePackageLimits } = require("../utils/packageCapacity.util");

const success = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

const failure = (res, error, statusCode = 400) =>
  res.status(statusCode).json({ success: false, error });

const normalizeCounts = (payload = {}) => {
  const reels = Math.max(0, Number(payload.noOfReels) || 0);
  const staticPosts = Math.max(0, Number(payload.noOfStaticPosts) || 0);
  const posts = Math.max(0, Number(payload.noOfPosts) || 0);
  const carousels = Math.max(0, Number(payload.noOfCarousels) || 0);
  return {
    reels,
    postsTotal: staticPosts + posts,
    carousels,
  };
};

const formatCapacityError = (kind, requested, max) => {
  if (kind === "reels") {
    return `Reels exceed capacity. Requested: ${requested}, Max allowed: ${max}`;
  }
  if (kind === "posts") {
    return `Posts exceed capacity. Requested: ${requested}, Max allowed: ${max}`;
  }
  return `Carousels exceed capacity. Requested: ${requested}, Max allowed: ${max}`;
};

const canManagerEditPackage = (pkg, userId) =>
  String(pkg?.createdBy || "") === String(userId || "");

const getPackages = async (req, res) => {
  try {
    const isAdmin = req.user?.roleType === "admin";
    const isManager = req.user?.roleType === "manager";
    if (!isAdmin && !isManager) {
      return failure(res, "Not authorized", 403);
    }

    const baseQuery = isAdmin
      ? { isDeleted: false }
      : {
          isDeleted: false,
          $or: [{ createdByRole: "admin" }, { createdBy: req.user.id }],
        };
    const packages = await Package.find(baseQuery).lean();
    const packageIds = packages.map((p) => p._id);
    const usageCounts = packageIds.length
      ? await Client.aggregate([
          { $match: { package: { $in: packageIds } } },
          { $group: { _id: "$package", count: { $sum: 1 } } },
        ])
      : [];
    const usageById = new Map(
      usageCounts.map((row) => [String(row._id), Number(row.count) || 0])
    );
    const enriched = packages
      .map((pkg) => {
        const isUsed = (usageById.get(String(pkg._id)) || 0) > 0;
        const isOwner = canManagerEditPackage(pkg, req.user.id);
        const isAdminPkg = pkg.createdByRole === "admin";
        const isEditable = isAdmin ? !isUsed : isOwner ? !isUsed : false;
        const isDeletable = isAdmin ? !isUsed : isOwner ? !isUsed : false;
        return {
          ...pkg,
          isInUse: isUsed,
          isUsed,
          isEditable,
          isDeletable,
          _sortPriority: isAdminPkg ? 0 : 1,
        };
      })
      .sort((a, b) => {
        if (a._sortPriority !== b._sortPriority) return a._sortPriority - b._sortPriority;
        return new Date(b.createdAt) - new Date(a.createdAt);
      })
      .map(({ _sortPriority, ...rest }) => rest);

    return success(res, enriched);
  } catch (error) {
    return failure(res, "Failed to fetch packages", 500);
  }
};

const createPackage = async (req, res) => {
  try {
    const isAdmin = req.user?.roleType === "admin";
    const isManager = req.user?.roleType === "manager";
    if (!isAdmin && !isManager) {
      return failure(res, "Not authorized", 403);
    }

    const { maxReels, maxPosts, maxCarousels } = await calculatePackageLimits();
    const { reels, postsTotal, carousels } = normalizeCounts(req.body);
    if (reels > maxReels) {
      return failure(res, formatCapacityError("reels", reels, maxReels), 400);
    }
    if (postsTotal > maxPosts) {
      return failure(res, formatCapacityError("posts", postsTotal, maxPosts), 400);
    }
    if (carousels > maxCarousels) {
      return failure(res, formatCapacityError("carousels", carousels, maxCarousels), 400);
    }

    const packageDoc = await Package.create({
      ...req.body,
      createdBy: req.user.id,
      createdByRole: req.user.roleType === "manager" ? "manager" : "admin",
    });
    return success(res, packageDoc, 201);
  } catch (error) {
    return failure(res, "Failed to create package", 500);
  }
};

const updatePackage = async (req, res) => {
  try {
    const { id } = req.params;
    const packageDoc = await Package.findById(id);

    if (!packageDoc) {
      return failure(res, "Package not found", 404);
    }

    const isAdmin = req.user?.roleType === "admin";
    const isManager = req.user?.roleType === "manager";
    if (!isAdmin && !isManager) {
      return failure(res, "Not authorized", 403);
    }
    if (isManager && !canManagerEditPackage(packageDoc, req.user.id)) {
      return failure(res, "Not authorized to edit this package", 403);
    }

    const isUsed = await Client.exists({ package: id });
    if (isUsed) {
      return failure(res, "Package already in use", 400);
    }

    const editableFields = [
      "name",
      "noOfReels",
      "noOfStaticPosts",
      "noOfPosts",
      "noOfCarousels",
      "noOfGoogleReviews",
      "gmbPosting",
      "campaignManagement",
      "isActive",
    ];

    editableFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        packageDoc[field] = req.body[field];
      }
    });

    const { maxReels, maxPosts, maxCarousels } = await calculatePackageLimits();
    const { reels, postsTotal, carousels } = normalizeCounts(packageDoc);
    if (reels > maxReels) {
      return failure(res, formatCapacityError("reels", reels, maxReels), 400);
    }
    if (postsTotal > maxPosts) {
      return failure(res, formatCapacityError("posts", postsTotal, maxPosts), 400);
    }
    if (carousels > maxCarousels) {
      return failure(res, formatCapacityError("carousels", carousels, maxCarousels), 400);
    }

    await packageDoc.save();
    return success(res, packageDoc);
  } catch (error) {
    return failure(res, "Failed to update package", 500);
  }
};

const deletePackage = async (req, res) => {
  try {
    const isAdmin = req.user?.roleType === "admin";
    const isManager = req.user?.roleType === "manager";
    if (!isAdmin && !isManager) {
      return failure(res, "Not authorized to delete package", 403);
    }

    const { id } = req.params;
    const packageDoc = await Package.findOne({ _id: id, isDeleted: false });

    if (!packageDoc) {
      return failure(res, "Package not found", 404);
    }

    if (isManager && !canManagerEditPackage(packageDoc, req.user.id)) {
      return failure(res, "Not authorized to delete this package", 403);
    }

    const clientsUsingPackage = await Client.countDocuments({ package: id });
    if (clientsUsingPackage > 0) {
      return failure(
        res,
        "Cannot delete used package",
        400
      );
    }

    await Package.findByIdAndUpdate(id, {
      $set: { isDeleted: true, isActive: false },
    });
    return success(res, { message: "Package deleted successfully" });
  } catch (error) {
    return failure(res, "Failed to delete package", 500);
  }
};

module.exports = {
  getPackages,
  createPackage,
  updatePackage,
  deletePackage,
};
