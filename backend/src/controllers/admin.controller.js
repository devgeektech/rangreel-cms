const Role = require("../models/Role");
const User = require("../models/User");

const toSlug = (value) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");

const success = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

const failure = (res, error, statusCode = 400) =>
  res.status(statusCode).json({ success: false, error });

const getRoles = async (req, res) => {
  try {
    const roles = await Role.find().sort({ createdAt: -1 });
    return success(res, roles);
  } catch (err) {
    return failure(res, "Failed to fetch roles", 500);
  }
};

const createRole = async (req, res) => {
  try {
    const { name, description, dashboardRoute, permissions, isSystem, isActive, color, icon } =
      req.body;

    if (!name) {
      return failure(res, "Role name is required", 400);
    }

    const slug = toSlug(name);
    if (!slug) {
      return failure(res, "Invalid role name", 400);
    }

    const role = await Role.create({
      name,
      slug,
      description,
      dashboardRoute,
      permissions: Array.isArray(permissions) ? permissions : [],
      isSystem: Boolean(isSystem),
      isActive: typeof isActive === "boolean" ? isActive : true,
      color,
      icon,
      createdBy: req.user.id,
    });

    return success(res, role, 201);
  } catch (err) {
    if (err && err.code === 11000) {
      return failure(res, "Role name or slug already exists", 409);
    }
    return failure(res, "Failed to create role", 500);
  }
};

const updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const role = await Role.findById(id);

    if (!role) {
      return failure(res, "Role not found", 404);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "slug")) {
      return failure(res, "Slug cannot be changed", 400);
    }

    if (Object.prototype.hasOwnProperty.call(req.body, "isSystem")) {
      return failure(res, "isSystem cannot be edited", 400);
    }

    const editableFields = [
      "name",
      "description",
      "dashboardRoute",
      "permissions",
      "isActive",
      "color",
      "icon",
    ];

    editableFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        role[field] = req.body[field];
      }
    });

    await role.save();
    return success(res, role);
  } catch (err) {
    if (err && err.code === 11000) {
      return failure(res, "Role name already exists", 409);
    }
    return failure(res, "Failed to update role", 500);
  }
};

const deleteRole = async (req, res) => {
  try {
    const { id } = req.params;
    const role = await Role.findById(id);

    if (!role) {
      return failure(res, "Role not found", 404);
    }

    if (role.isSystem) {
      return failure(res, "System roles cannot be deleted", 400);
    }

    const usersAssigned = await User.countDocuments({ role: role._id });
    if (usersAssigned > 0) {
      return failure(res, "Role has assigned users and cannot be deleted", 400);
    }

    await role.deleteOne();
    return success(res, { message: "Role deleted successfully" });
  } catch (err) {
    return failure(res, "Failed to delete role", 500);
  }
};

const getManagers = async (req, res) => {
  try {
    const managers = await User.find({ roleType: "manager" })
      .populate("role")
      .sort({ createdAt: -1 });
    return success(res, managers);
  } catch (err) {
    return failure(res, "Failed to fetch managers", 500);
  }
};

const createManager = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    const managerRole = await Role.findOne({ slug: "manager" });
    if (!managerRole) {
      return failure(res, "Manager role not found", 404);
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return failure(res, "Email already in use", 409);
    }

    const manager = await User.create({
      name,
      email,
      phone,
      password,
      role: managerRole._id,
      roleType: "manager",
      isActive: true,
      mustChangePass: true,
      createdBy: req.user.id,
    });

    const createdManager = await User.findById(manager._id).populate("role");
    return success(res, createdManager, 201);
  } catch (err) {
    return failure(res, "Failed to create manager", 500);
  }
};

const updateManager = async (req, res) => {
  try {
    const { id } = req.params;
    const manager = await User.findById(id);

    if (!manager || manager.roleType !== "manager") {
      return failure(res, "Manager not found", 404);
    }

    const { name, email, phone, isActive } = req.body;

    if (email && email.toLowerCase() !== manager.email) {
      const exists = await User.findOne({ email: email.toLowerCase(), _id: { $ne: id } });
      if (exists) {
        return failure(res, "Email already in use", 409);
      }
      manager.email = email;
    }

    if (typeof name !== "undefined") manager.name = name;
    if (typeof phone !== "undefined") manager.phone = phone;
    if (typeof isActive === "boolean") manager.isActive = isActive;

    await manager.save();
    const updatedManager = await User.findById(manager._id).populate("role");
    return success(res, updatedManager);
  } catch (err) {
    return failure(res, "Failed to update manager", 500);
  }
};

const resetManagerPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword) {
      return failure(res, "newPassword is required", 400);
    }

    const manager = await User.findById(id).select("+password");
    if (!manager || manager.roleType !== "manager") {
      return failure(res, "Manager not found", 404);
    }

    manager.password = newPassword;
    manager.mustChangePass = true;
    await manager.save();

    return success(res, { message: "Manager password reset successfully" });
  } catch (err) {
    return failure(res, "Failed to reset manager password", 500);
  }
};

const getUsers = async (req, res) => {
  try {
    const { role: roleSlug, search, includeAdmins } = req.query;
    const shouldIncludeAdmins =
      includeAdmins === true || includeAdmins === "true" || includeAdmins === "1";

    const query = shouldIncludeAdmins
      ? { roleType: { $in: ["user", "admin"] } }
      : { roleType: "user" };

    if (search) {
      query.name = { $regex: search, $options: "i" };
    }

    if (roleSlug) {
      const role = await Role.findOne({ slug: roleSlug });
      if (!role) {
        return success(res, []);
      }
      query.role = role._id;
    }

    const users = await User.find(query).populate("role").sort({ createdAt: -1 });
    return success(res, users);
  } catch (err) {
    return failure(res, "Failed to fetch users", 500);
  }
};

const createUser = async (req, res) => {
  try {
    const { name, email, phone, password, roleId } = req.body;

    if (!roleId) {
      return failure(res, "roleId is required", 400);
    }

    const role = await Role.findById(roleId);
    if (!role) {
      return failure(res, "Role not found", 404);
    }

    if (role.isSystem) {
      return failure(res, "System roles cannot be assigned for user creation", 400);
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return failure(res, "Email already in use", 409);
    }

    const user = await User.create({
      name,
      email,
      phone,
      password,
      role: role._id,
      roleType: "user",
      isActive: true,
      mustChangePass: true,
      createdBy: req.user.id,
    });

    const createdUser = await User.findById(user._id).populate("role");
    return success(res, createdUser, 201);
  } catch (err) {
    return failure(res, "Failed to create user", 500);
  }
};

const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findById(id);

    if (!user || user.roleType !== "user") {
      return failure(res, "User not found", 404);
    }

    const { name, email, phone, roleId, isActive } = req.body;

    if (email && email.toLowerCase() !== user.email) {
      const exists = await User.findOne({ email: email.toLowerCase(), _id: { $ne: id } });
      if (exists) {
        return failure(res, "Email already in use", 409);
      }
      user.email = email;
    }

    if (roleId) {
      const role = await Role.findById(roleId);
      if (!role) {
        return failure(res, "Role not found", 404);
      }
      if (role.isSystem) {
        return failure(res, "System roles cannot be assigned to users", 400);
      }
      user.role = role._id;
    }

    if (typeof name !== "undefined") user.name = name;
    if (typeof phone !== "undefined") user.phone = phone;
    if (typeof isActive === "boolean") user.isActive = isActive;

    await user.save();
    const updatedUser = await User.findById(user._id).populate("role");
    return success(res, updatedUser);
  } catch (err) {
    return failure(res, "Failed to update user", 500);
  }
};

const resetUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword) {
      return failure(res, "newPassword is required", 400);
    }

    const user = await User.findById(id).select("+password");
    if (!user || user.roleType !== "user") {
      return failure(res, "User not found", 404);
    }

    user.password = newPassword;
    user.mustChangePass = true;
    await user.save();

    return success(res, { message: "User password reset successfully" });
  } catch (err) {
    return failure(res, "Failed to reset user password", 500);
  }
};

module.exports = {
  getRoles,
  createRole,
  updateRole,
  deleteRole,
  getManagers,
  createManager,
  updateManager,
  resetManagerPassword,
  getUsers,
  createUser,
  updateUser,
  resetUserPassword,
};
