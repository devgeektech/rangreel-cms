const User = require("../models/User");

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).populate("role");

    if (!user || !user.isActive) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    return res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Failed to fetch user" });
  }
};

module.exports = {
  getMe,
};
