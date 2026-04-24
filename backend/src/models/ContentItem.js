const mongoose = require("mongoose");
const {
  assignDisplayIdFields,
  assignDisplayIdFieldsMany,
  refreshDisplayIdMonthIfNeeded,
} = require("../utils/taskDisplayId.util");

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
    type: {
      type: String,
      enum: ["reel", "post", "carousel"],
      default: "reel",
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
    isCustomCalendar: {
      type: Boolean,
      default: false,
    },
    weekendEnabled: {
      type: Boolean,
      default: false,
    },
    taskNumber: {
      type: Number,
      min: 1,
    },
    taskType: {
      type: String,
      enum: ["Post", "Reel", "Carousel"],
    },
    displayId: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

contentItemSchema.pre("save", async function contentItemDisplayIdPreSave() {
  try {
    if (this.isNew && (!this.displayId || String(this.displayId).trim() === "")) {
      const plain = this.toObject({ depopulate: true });
      const nextFields = await assignDisplayIdFields(plain);
      this.taskNumber = nextFields.taskNumber;
      this.taskType = nextFields.taskType;
      this.displayId = nextFields.displayId;
    } else if (!this.isNew && this.isModified("workflowStages")) {
      await refreshDisplayIdMonthIfNeeded(this);
    }
  } catch (err) {
    console.warn("[ContentItem] displayId pre-save:", err?.message || err);
  }
});

contentItemSchema.pre("insertMany", async function contentItemDisplayIdPreInsertMany(...args) {
  const docs =
    (Array.isArray(args[0]) && args[0]) ||
    (Array.isArray(args[1]) && args[1]) ||
    [];
  if (docs.length) {
    await assignDisplayIdFieldsMany(docs);
  }
});

module.exports =
  mongoose.models.ContentItem ||
  mongoose.model("ContentItem", contentItemSchema);

