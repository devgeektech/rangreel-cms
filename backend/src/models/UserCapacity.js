const mongoose = require("mongoose");

const CAP_DEFAULT = 7;

const userCapacitySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    dailyReelEditCap: { type: Number, default: CAP_DEFAULT, min: 0 },
    dailyReelShootCap: { type: Number, default: CAP_DEFAULT, min: 0 },
    dailyDesignCap: { type: Number, default: CAP_DEFAULT, min: 0 },
    dailyPlanCap: { type: Number, default: CAP_DEFAULT, min: 0 },
    dailyPostCap: { type: Number, default: CAP_DEFAULT, min: 0 },
    dailyApproveCap: { type: Number, default: CAP_DEFAULT, min: 0 },
    dailyGeneralCap: { type: Number, default: CAP_DEFAULT, min: 0 },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.UserCapacity || mongoose.model("UserCapacity", userCapacitySchema);
