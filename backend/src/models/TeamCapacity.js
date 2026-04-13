const mongoose = require("mongoose");
const { TEAM_CAPACITY_ROLES } = require("../constants/roleCapacityMap");

const teamCapacitySchema = new mongoose.Schema(
  {
    role: {
      type: String,
      required: true,
      enum: TEAM_CAPACITY_ROLES,
      unique: true,
    },
    reelCapacity: { type: Number, default: 0, min: 0 },
    postCapacity: { type: Number, default: 0, min: 0 },
    carouselCapacity: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

const TeamCapacity =
  mongoose.models.TeamCapacity || mongoose.model("TeamCapacity", teamCapacitySchema);

module.exports = TeamCapacity;
module.exports.TEAM_ROLES = TEAM_CAPACITY_ROLES;
