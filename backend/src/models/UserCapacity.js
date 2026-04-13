const mongoose = require("mongoose");
const { TEAM_CAPACITY_ROLES } = require("../constants/roleCapacityMap");

const userCapacitySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    role: {
      type: String,
      required: true,
      enum: TEAM_CAPACITY_ROLES,
    },
    reelCapacity: { type: Number, default: 0, min: 0 },
    postCapacity: { type: Number, default: 0, min: 0 },
    carouselCapacity: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.UserCapacity || mongoose.model("UserCapacity", userCapacitySchema);
