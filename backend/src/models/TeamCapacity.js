const mongoose = require("mongoose");

const TEAM_ROLES = [
  "strategist",
  "videographer",
  "videoEditor",
  "manager",
  "postingExecutive",
  "graphicDesigner",
  "photographer",
];

const teamCapacitySchema = new mongoose.Schema(
  {
    role: {
      type: String,
      required: true,
      enum: TEAM_ROLES,
      unique: true,
    },
    dailyCapacity: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.TeamCapacity || mongoose.model("TeamCapacity", teamCapacitySchema);

module.exports.TEAM_ROLES = TEAM_ROLES;
