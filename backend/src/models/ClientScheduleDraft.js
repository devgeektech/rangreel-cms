const mongoose = require("mongoose");

const STAGE_NAMES = ["Plan", "Shoot", "Edit", "Design", "Approval", "Post"];
const ITEM_TYPES = ["reel", "post", "carousel"];

const DraftStageSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      enum: STAGE_NAMES,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      required: true,
      trim: true,
    },
    assignedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      required: true,
      trim: true,
      default: "assigned",
    },
  },
  { _id: false }
);

const DraftItemSchema = new mongoose.Schema(
  {
    contentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ContentItem",
      required: true,
    },
    type: {
      type: String,
      enum: ITEM_TYPES,
      required: true,
    },
    stages: {
      type: [DraftStageSchema],
      default: [],
    },
    postingDate: {
      type: Date,
      required: true,
    },
    isLocked: {
      type: Boolean,
      default: true,
      immutable: true,
    },
    /** PROMPT 58: duration tasks derived from stages (optional; regenerated when absent). */
    tasks: {
      type: [mongoose.Schema.Types.Mixed],
      default: undefined,
    },
  },
  { _id: false }
);

const clientScheduleDraftSchema = new mongoose.Schema(
  {
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
      unique: true,
      index: true,
    },
    items: {
      type: [DraftItemSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

module.exports =
  mongoose.models.ClientScheduleDraft ||
  mongoose.model("ClientScheduleDraft", clientScheduleDraftSchema);

