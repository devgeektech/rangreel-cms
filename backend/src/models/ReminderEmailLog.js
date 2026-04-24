const mongoose = require("mongoose");

const reminderEmailLogSchema = new mongoose.Schema(
  {
    contentItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ContentItem",
      required: true,
      index: true,
    },
    stageId: {
      type: String,
      required: true,
      trim: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    dayKey: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
  },
  { timestamps: true }
);

reminderEmailLogSchema.index(
  { contentItem: 1, stageId: 1, user: 1, dayKey: 1 },
  { unique: true }
);

module.exports =
  mongoose.models.ReminderEmailLog ||
  mongoose.model("ReminderEmailLog", reminderEmailLogSchema);
