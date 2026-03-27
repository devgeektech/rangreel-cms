const mongoose = require("mongoose");

const WorkflowStageSchema = new mongoose.Schema(
  {
    stageName: {
      type: String,
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
    },
    dueDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: [
        "planned",
        "assigned",
        "in_progress",
        "completed",
        "submitted",
        "approved",
        "rejected",
        "scheduled",
        "posted",
      ],
      default: "planned",
    },
    rejectionNote: {
      type: String,
      default: "",
      trim: true,
    },
    completedAt: {
      type: Date,
    },
    hook: { type: String, trim: true, default: "" },
    concept: { type: String, trim: true, default: "" },
    captionDirection: { type: String, trim: true, default: "" },
    contentBrief: {
      type: [String],
      default: [],
      // contentBrief is strategist-defined content points for the reel.
    },
    footageLink: { type: String, trim: true, default: "" },
    editedFileLink: { type: String, trim: true, default: "" },
    designFileLink: { type: String, trim: true, default: "" },
  }
);

const contentItemSchema = new mongoose.Schema(
  {
    client: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    contentType: {
      type: String,
      enum: ["reel", "static_post", "carousel", "gmb_post", "campaign"],
      required: true,
    },
    plan: {
      type: String,
      enum: ["normal", "urgent"],
      default: "normal",
    },
    planType: {
      type: String,
      enum: ["urgent", "normal"],
      default: "normal",
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    videoUrl: {
      type: String,
      trim: true,
      default: "",
    },
    month: {
      type: String,
      required: true,
      trim: true,
    },
    clientPostingDate: {
      type: Date,
      required: true,
      immutable: true,
    },
    overallStatus: {
      type: String,
      enum: [
        "planning",
        "shooting",
        "working",
        "editing",
        "approval",
        "scheduled",
        "posted",
      ],
      default: "planning",
    },
    workflowStages: {
      type: [WorkflowStageSchema],
      default: [],
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

module.exports =
  mongoose.models.ContentItem ||
  mongoose.model("ContentItem", contentItemSchema);

