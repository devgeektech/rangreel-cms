const mongoose = require("mongoose");

/** User refs on team are optional so packages may include only reels, posts, or carousels. */
const userRefOptional = { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false };

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
    /**
     * Effective schedule counts for this client (subset of package allowed at creation).
     * When set, calendar generation uses these instead of package counts.
     */
    activeContentCounts: {
      noOfReels: { type: Number, min: 0 },
      noOfStaticPosts: { type: Number, min: 0 },
      noOfCarousels: { type: Number, min: 0 },
    },
    team: {
      reels: {
        strategist: userRefOptional,
        videographer: userRefOptional,
        videoEditor: userRefOptional,
        manager: userRefOptional,
        postingExecutive: userRefOptional,
      },
      posts: {
        strategist: userRefOptional,
        graphicDesigner: userRefOptional,
        manager: userRefOptional,
        postingExecutive: userRefOptional,
      },
      carousel: {
        strategist: userRefOptional,
        graphicDesigner: userRefOptional,
        manager: userRefOptional,
        postingExecutive: userRefOptional,
      },
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

