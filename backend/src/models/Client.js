const mongoose = require("mongoose");

const clientSchema = new mongoose.Schema(
  {
    clientName: {
      type: String,
      required: true,
      trim: true,
    },
    brandName: {
      type: String,
      required: true,
      trim: true,
    },
    industry: {
      type: String,
      default: "",
    },
    businessType: {
      type: String,
      default: "",
    },
    socialHandles: {
      instagram: { type: String, default: "" },
      facebook: { type: String, default: "" },
      youtube: { type: String, default: "" },
      googleBusiness: { type: String, default: "" },
    },
    startDate: {
      type: Date,
      required: true,
    },
    /** Set by calendarService.generateClientPackageOnce from max workflow stage due dates. */
    endDate: {
      type: Date,
      required: false,
    },
    googleReviewsTarget: {
      type: Number,
      default: 0,
      min: 0,
    },
    googleReviewsAchieved: {
      type: Number,
      default: 0,
      min: 0,
    },
    status: {
      type: String,
      enum: ["active", "inactive", "paused"],
      default: "active",
    },
    manager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    package: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Package",
      required: true,
    },
    team: {
      strategist: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      videographer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      videoEditor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      graphicDesigner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      postingExecutive: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      campaignManager: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      photographer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    isActive: {
      type: Boolean,
      default: true,
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
  mongoose.models.Client || mongoose.model("Client", clientSchema);

