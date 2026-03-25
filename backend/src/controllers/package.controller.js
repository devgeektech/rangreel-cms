const Package = require("../models/Package");

const success = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

const failure = (res, error, statusCode = 400) =>
  res.status(statusCode).json({ success: false, error });

const getPackages = async (req, res) => {
  try {
    const packages = await Package.find().sort({ createdAt: -1 });
    return success(res, packages);
  } catch (error) {
    return failure(res, "Failed to fetch packages", 500);
  }
};

const createPackage = async (req, res) => {
  try {
    const packageDoc = await Package.create({
      ...req.body,
      createdBy: req.user.id,
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
    const { id } = req.params;
    const packageDoc = await Package.findById(id);

    if (!packageDoc) {
      return failure(res, "Package not found", 404);
    }

    await packageDoc.deleteOne();
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
