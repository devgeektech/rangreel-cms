const mongoose = require("mongoose");

const scheduleItemSchema = new mongoose.Schema(
  {
    contentItem: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ContentItem",
      required: true,
    },
    title: { type: String, default: "" },
    postingDate: { type: Date, required: true },
  },
  { _id: false }
);

const scheduleSchema = new mongoose.Schema(
  {
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
      index: true,
    },
    monthIndex: {
      type: Number,
      required: true,
      min: 0,
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    items: {
      type: [scheduleItemSchema],
      default: [],
    },
    isEditable: {
      type: Boolean,
      default: true,
    },
    /** Copied from client for downstream UI / custom drag rules. */
    isCustomCalendar: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

scheduleSchema.index({ clientId: 1, monthIndex: 1 }, { unique: true });

module.exports = mongoose.model("Schedule", scheduleSchema);
