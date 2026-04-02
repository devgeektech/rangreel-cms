const mongoose = require("mongoose");

/**
 * PROMPT 73 — Leave model (per user)
 * Stores leave as an inclusive UTC date range.
 */
const leaveSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    startDate: {
      type: Date,
      required: true,
      index: true,
    },
    endDate: {
      type: Date,
      required: true,
      index: true,
    },
    reason: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    createdByRole: {
      type: String,
      enum: ["admin", "manager"],
      required: true,
    },
    // Explicit per prompt; we do not use timestamps to avoid field mismatch.
    createdAt: { type: Date, default: Date.now, required: true },
  },
  { timestamps: false }
);

leaveSchema.index({ userId: 1 });
leaveSchema.index({ startDate: 1 });
leaveSchema.index({ endDate: 1 });

module.exports =
  mongoose.models.Leave || mongoose.model("Leave", leaveSchema);

