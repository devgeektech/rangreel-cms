const mongoose = require("mongoose");

const calendarLockSchema = new mongoose.Schema(
  {
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    month: {
      type: String,
      required: true,
      trim: true,
    },
    lockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    lockedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    updatedAt: false,
  }
);

calendarLockSchema.index({ client: 1, month: 1 }, { unique: true });

module.exports =
  mongoose.models.CalendarLock ||
  mongoose.model("CalendarLock", calendarLockSchema);

