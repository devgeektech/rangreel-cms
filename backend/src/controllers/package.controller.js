const Package = require("../models/Package");
const Client = require("../models/Client");

const success = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

const failure = (res, error, statusCode = 400) =>
  res.status(statusCode).json({ success: false, error });

const getPackages = async (req, res) => {
  try {
    const packages = await Package.find({ isDeleted: false }).sort({ createdAt: -1 }).lean();
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
    const enriched = packages.map((pkg) => ({
      ...pkg,
      isInUse: (usageById.get(String(pkg._id)) || 0) > 0,
    }));
    return success(res, enriched);
  } catch (error) {
    return failure(res, "Failed to fetch packages", 500);
  }
};

const createPackage = async (req, res) => {
  try {
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

    await packageDoc.save();
    return success(res, packageDoc);
  } catch (error) {
    return failure(res, "Failed to update package", 500);
  }
};

const deletePackage = async (req, res) => {
  try {
    if (req.user?.roleType !== "admin" && req.user?.roleType !== "manager") {
      return failure(res, "Not authorized to delete package", 403);
    }

    const { id } = req.params;
    const packageDoc = await Package.findOne({ _id: id, isDeleted: false });

    if (!packageDoc) {
      return failure(res, "Package not found", 404);
    }

    const clientsUsingPackage = await Client.countDocuments({ package: id });
    if (clientsUsingPackage > 0) {
      return failure(
        res,
        "Package cannot be deleted. It is assigned to active clients.",
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
