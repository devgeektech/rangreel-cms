const path = require("path");
const mongoose = require("mongoose");
const dotenv = require("dotenv");

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const Role = require("../src/models/Role");
const User = require("../src/models/User");

const rolesToSeed = [
  {
    name: "Admin",
    slug: "admin",
    dashboardRoute: "/admin",
    isSystem: true,
    color: "#6C3EBF",
    icon: "Shield",
    permissions: ["*"],
    isActive: true,
  },
  {
    name: "Manager",
    slug: "manager",
    dashboardRoute: "/manager",
    isSystem: true,
    color: "#E84393",
    icon: "Users",
    permissions: [],
    isActive: true,
  },
  {
    name: "Campaign Manager",
    slug: "campaign-manager",
    dashboardRoute: "/campaign-manager",
    isSystem: false,
    color: "#BE185D",
    icon: "Briefcase",
    permissions: [],
    isActive: true,
  },
  {
    name: "Strategist",
    slug: "strategist",
    dashboardRoute: "/strategist",
    isSystem: false,
    color: "#0EA5E9",
    icon: "Lightbulb",
    permissions: [],
    isActive: true,
  },
  {
    name: "Videographer",
    slug: "videographer",
    dashboardRoute: "/videographer",
    isSystem: false,
    color: "#F59E0B",
    icon: "Video",
    permissions: [],
    isActive: true,
  },
  {
    name: "Editor",
    slug: "editor",
    dashboardRoute: "/editor",
    isSystem: false,
    color: "#10B981",
    icon: "Scissors",
    permissions: [],
    isActive: true,
  },
  {
    name: "Graphic Designer",
    slug: "designer",
    dashboardRoute: "/designer",
    isSystem: false,
    color: "#8B5CF6",
    icon: "Palette",
    permissions: [],
    isActive: true,
  },
  {
    name: "Posting Executive",
    slug: "posting",
    dashboardRoute: "/posting",
    isSystem: false,
    color: "#EF4444",
    icon: "Send",
    permissions: [],
    isActive: true,
  },
  {
    name: "Customer",
    slug: "customer",
    dashboardRoute: "/customer",
    isSystem: false,
    color: "#2563EB",
    icon: "UserRound",
    permissions: [],
    isActive: true,
  },
];

const seed = async () => {
  try {
    console.log("Loading environment from backend/.env");
    console.log("Connecting to MongoDB...");
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("MongoDB connected");

    console.log("Upserting roles...");
    for (const roleData of rolesToSeed) {
      let roleBySlug = await Role.findOne({ slug: roleData.slug });
      let roleByName = await Role.findOne({ name: roleData.name });
      let primaryRole = roleBySlug || roleByName;

      if (roleBySlug && roleByName && roleBySlug._id.toString() !== roleByName._id.toString()) {
        await User.updateMany({ role: roleByName._id }, { $set: { role: roleBySlug._id } });
        await Role.deleteOne({ _id: roleByName._id });
        console.log(
          `Merged duplicate role ${roleByName.name} (${roleByName.slug}) into ${roleBySlug.name} (${roleBySlug.slug})`
        );
        roleByName = roleBySlug;
        primaryRole = roleBySlug;
      }

      if (!primaryRole) {
        primaryRole = await Role.create(roleData);
      } else {
        Object.assign(primaryRole, roleData);
        await primaryRole.save();
      }

      const role = primaryRole;
      console.log(`Role upserted: ${role.name} (${role.slug})`);
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env");
    }

    const adminRole = await Role.findOne({ slug: "admin" });
    if (!adminRole) {
      throw new Error("Admin role not found after role seeding");
    }

    console.log(`Checking admin user by email: ${adminEmail}`);
    const existingAdmin = await User.findOne({ email: adminEmail.toLowerCase() });

    if (existingAdmin) {
      console.log("Admin user already exists. Skipping creation.");
    } else {
      await User.create({
        name: "Super Admin",
        email: adminEmail,
        password: adminPassword,
        role: adminRole._id,
        roleType: "admin",
        isActive: true,
        mustChangePass: false,
      });
      console.log("Admin user created successfully.");
    }

    console.log("Seed completed successfully.");
  } catch (error) {
    console.error("Seed failed:", error.message);
    process.exitCode = 1;
  } finally {
    console.log("Disconnecting from MongoDB...");
    await mongoose.disconnect();
    console.log("MongoDB disconnected.");
  }
};

seed();
