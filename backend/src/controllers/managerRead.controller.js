const Package = require("../models/Package");
const User = require("../models/User");

const success = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

const failure = (res, error, statusCode = 400) =>
  res.status(statusCode).json({ success: false, error });

const getPackages = async (req, res) => {
  try {
    const packages = await Package.find({ isActive: true }).sort({ createdAt: -1 });
    return success(res, packages);
  } catch (err) {
    return failure(res, "Failed to fetch packages", 500);
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

module.exports = {
  getPackages,
  getTeamUsers,
};

