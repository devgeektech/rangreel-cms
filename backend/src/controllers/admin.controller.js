const Role = require("../models/Role");
const User = require("../models/User");
const Client = require("../models/Client");
const ContentItem = require("../models/ContentItem");

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

const toYMD = (value) => {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
};

const dedupeById = (docs) => {
  const out = [];
  const seen = new Set();
  for (const d of docs || []) {
    const id = d?._id ? String(d._id) : "";
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(d);
  }
  return out;
};

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

const getAdminClients = async (req, res) => {
  try {
    const clients = await Client.find()
      .populate("manager", "name avatar")
      .populate("package", "name")
      .sort({ createdAt: -1 });

    const clientIds = clients.map((c) => c._id);
    const items = await ContentItem.find({ client: { $in: clientIds } })
      .select("client title type contentType clientPostingDate workflowStages")
      .sort({ clientPostingDate: 1 })
      .lean();
    const byClient = new Map();
    for (const it of items) {
      const key = String(it.client);
      if (!byClient.has(key)) byClient.set(key, []);
      byClient.get(key).push({
        _id: it._id,
        title: it.title,
        type: it.type,
        contentType: it.contentType,
        postingDate: toYMD(it.clientPostingDate),
        stages: (it.workflowStages || []).map((s) => ({
          stageName: s.stageName,
          dueDate: toYMD(s.dueDate),
          role: s.role,
          status: s.status,
          assignedUser: s.assignedUser || null,
        })),
      });
    }

    const payload = clients.map((c) => {
      const obj = c.toObject ? c.toObject() : c;
      obj.contentItems = byClient.get(String(c._id)) || [];
      return obj;
    });

    return success(res, payload);
  } catch (err) {
    return failure(res, "Failed to fetch clients", 500);
  }
};

const getAdminCalendar = async (req, res) => {
  try {
    const { month } = req.query;

    const normalized = month && String(month).match(/^(\d{4})-(\d{2})$/);
    if (!normalized) {
      return failure(res, "month must be in format YYYY-MM", 400);
    }

    const itemsRaw = await ContentItem.find({ month })
      .populate("client", "clientName brandName")
      .sort({ clientPostingDate: 1 })
      .lean();
    const items = dedupeById(itemsRaw);

    const ymdUTC = (d) => {
      const year = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, "0");
      const day = String(d.getUTCDate()).padStart(2, "0");
      return `${year}-${m}-${day}`;
    };

    const groupsMap = new Map();
    for (const item of items) {
      const key = item.clientPostingDate ? ymdUTC(new Date(item.clientPostingDate)) : "unknown";
      if (!groupsMap.has(key)) {
        groupsMap.set(key, {
          clientPostingDate: key,
          items: [],
        });
      }
      groupsMap.get(key).items.push(item);
    }

    const groups = [...groupsMap.values()]
      .map((g) => ({ ...g, items: dedupeById(g.items || []) }))
      .sort(
      (a, b) => new Date(a.clientPostingDate) - new Date(b.clientPostingDate)
    );

    return success(res, { month, groups });
  } catch (err) {
    return failure(res, err.message || "Failed to fetch admin calendar", 500);
  }
};

// Prompt 37: Admin global calendar (all content items).
const getAdminGlobalCalendar = async (req, res) => {
  try {
    const itemsRaw = await ContentItem.find()
      .populate("client", "clientName brandName")
      .sort({ clientPostingDate: 1 })
      .lean();
    const items = dedupeById(itemsRaw);

    const payload = (items || []).map((item) => {
      const postStage = (item.workflowStages || []).find(
        (s) => String(s?.stageName || "").toLowerCase() === "post"
      );
      const postStatus = String(postStage?.status || "").toLowerCase();

      const overallStatus = postStatus === "completed" ? "completed" : "pending";
      const clientName = item.client?.clientName || item.client?.brandName || "";

      return {
        _id: item._id,
        title: item.title,
        clientName,
        postingDate: toYMD(item.clientPostingDate),
        planType: item.planType || item.plan || "normal",
        overallStatus,
      };
    });

    return success(res, payload);
  } catch (err) {
    return failure(res, err.message || "Failed to fetch admin global calendar", 500);
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
  getAdminClients,
  getAdminCalendar,
  getAdminGlobalCalendar,
};
