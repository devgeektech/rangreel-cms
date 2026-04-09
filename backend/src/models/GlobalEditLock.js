const mongoose = require("mongoose");

const globalEditLockSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: "manager-global-drag-lock",
      trim: true,
    },
    lockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    lockedAt: {
      type: Date,
      default: Date.now,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 },
    },
  },
  {
    timestamps: false,
  }
);

module.exports =
  mongoose.models.GlobalEditLock ||
  mongoose.model("GlobalEditLock", globalEditLockSchema);
