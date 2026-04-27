const jwt = require("jsonwebtoken");
const User = require("../models/User");

const PASSWORD_REGEX =
  /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_\-+=[\]{};':"\\|,.<>/?]).{8,}$/;

const ROLE_SLUG_DASHBOARD_ROUTE = {
  strategist: "/strategist",
  videographer: "/videographer",
  editor: "/editor",
  "video-editor": "/editor",
  videoeditor: "/editor",
  designer: "/designer",
  "graphic-designer": "/designer",
  graphicdesigner: "/designer",
  posting: "/posting",
  "posting-executive": "/posting",
  postingexecutive: "/posting",
  campaignmanager: "/campaign-manager",
  "campaign-manager": "/campaign-manager",
};

const resolveDashboardRoute = (user) => {
  if (user.roleType === "admin") return "/admin";
  if (user.roleType === "manager") return "/manager";
  if (user.role && user.role.dashboardRoute) return user.role.dashboardRoute;
  const slug = String(user?.role?.slug || "").toLowerCase();
  if (slug && ROLE_SLUG_DASHBOARD_ROUTE[slug]) {
    return ROLE_SLUG_DASHBOARD_ROUTE[slug];
  }
  return "/";
};

const getJwtPayload = (user, dashboardRoute) => ({
  id: user._id,
  roleType: user.roleType,
  dashboardRoute: dashboardRoute || "",
  roleSlug: String(user?.role?.slug || "").toLowerCase(),
  mustChangePass: user.mustChangePass,
});

const signToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
  });

const getCookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  maxAge: 7 * 24 * 60 * 60 * 1000,
});

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email: email.toLowerCase(), isActive: true })
      .select("+password")
      .populate("role");

    if (!user) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid credentials" });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid credentials" });
    }

    const dashboardRoute = resolveDashboardRoute(user);
    const payload = getJwtPayload(user, dashboardRoute);
    const token = signToken(payload);

    res.cookie("rangreel_token", token, getCookieOptions());

    return res.status(200).json({
      success: true,
      token,
      user: {
        name: user.name,
        email: user.email,
        roleType: user.roleType,
        role: user.role,
        dashboardRoute,
        mustChangePass: user.mustChangePass,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Login failed" });
  }
};

const logout = async (req, res) => {
  try {
    res.clearCookie("rangreel_token");
    return res.status(200).json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Logout failed" });
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        error: "Current password and new password are required",
      });
    }

    if (!PASSWORD_REGEX.test(newPassword)) {
      return res.status(400).json({
        success: false,
        error:
          "New password must be at least 8 characters and include uppercase, number, and special character",
      });
    }

    const user = await User.findById(req.user.id).select("+password").populate("role");
    if (!user || !user.isActive) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res
        .status(401)
        .json({ success: false, error: "Current password is incorrect" });
    }

    user.password = newPassword;
    user.mustChangePass = false;
    await user.save();

    const dashboardRoute = resolveDashboardRoute(user);
    const payload = getJwtPayload(user, dashboardRoute);
    const token = signToken(payload);

    res.cookie("rangreel_token", token, getCookieOptions());

    return res.status(200).json({
      success: true,
      token,
      user: {
        name: user.name,
        email: user.email,
        roleType: user.roleType,
        role: user.role,
        dashboardRoute,
        mustChangePass: user.mustChangePass,
      },
    });
  } catch (error) {
    return res
      .status(500)
      .json({ success: false, error: "Password change failed" });
  }
};

module.exports = {
  login,
  logout,
  changePassword,
};
