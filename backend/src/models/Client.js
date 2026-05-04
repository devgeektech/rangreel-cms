const mongoose = require("mongoose");

/** User refs on team are optional so packages may include only reels, posts, or carousels. */
const userRefOptional = { type: mongoose.Schema.Types.ObjectId, ref: "User", required: false };

const briefAssetFileSchema = new mongoose.Schema(
  {
    storedName: { type: String, required: true },
    originalName: { type: String, default: "", trim: true },
    mimeType: { type: String, default: "" },
    size: { type: Number, default: 0 },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const clientBriefSchema = new mongoose.Schema(
  {
    usp: { type: String, default: "", trim: true },
    brandTone: {
      type: String,
      enum: ["luxury", "premium", "bold", "friendly", "minimal", "other", ""],
      default: "",
    },
    brandToneOther: { type: String, default: "", trim: true },
    targetAudience: { type: String, default: "", trim: true },
    keyProductsServices: { type: String, default: "", trim: true },
    priorityFocus: { type: String, default: "", trim: true },
    festivalsToTarget: { type: String, default: "", trim: true },
    language: {
      type: String,
      enum: ["english", "hindi", "other", ""],
      default: "english",
    },
    languageOther: { type: String, default: "", trim: true },
    competitors: { type: String, default: "", trim: true },
    accountsYouLikeReason: { type: String, default: "", trim: true },
    mainGoal: {
      type: String,
      enum: ["awareness", "sales", "social_growth", ""],
      default: "",
    },
    ageGroup: { type: String, default: "", trim: true },
    focusLocations: { type: String, default: "", trim: true },
    contentPreference: {
      type: [
        {
          type: String,
          enum: ["education", "promotional", "entertaining", "trend_based"],
        },
      ],
      default: [],
    },
    shootAvailability: {
      storeOrOfficeForShoot: { type: Boolean, default: false },
      productsReadyForShoot: { type: Boolean, default: false },
      modelsAvailable: { type: Boolean, default: false },
    },
    preferredShootDaysTiming: { type: String, default: "", trim: true },
    bestPostingTime: { type: String, default: "", trim: true },
    /** Uploaded onboarding files (local disk; see POST …/brief-assets). */
    brandKitFiles: { type: [briefAssetFileSchema], default: [] },
    socialCredentialsFiles: { type: [briefAssetFileSchema], default: [] },
    otherBriefFiles: { type: [briefAssetFileSchema], default: [] },
    agreementFiles: { type: [briefAssetFileSchema], default: [] },
    /** Legacy: optional external links. Prefer brandKitFiles / other uploads. */
    driveBrandKitUrl: { type: String, default: "", trim: true },
    driveSocialCredentialsUrl: { type: String, default: "", trim: true },
    driveOtherFilesUrl: { type: String, default: "", trim: true },
  },
  { _id: false }
);

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
    contactNumber: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true },
    website: { type: String, default: "", trim: true },
    industry: {
      type: String,
      default: "",
    },
    businessType: {
      type: String,
      default: "",
    },
    /** Free-text dump for “all social credentials” plus structured handles below. */
    socialCredentialsNotes: { type: String, default: "", trim: true },
    /** Per-platform { username, password }; legacy string values normalized on write. */
    socialHandles: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
    clientBrief: {
      type: clientBriefSchema,
      default: () => ({}),
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
    isCustomCalendar: {
      type: Boolean,
      default: false,
    },
    weekendEnabled: {
      type: Boolean,
      default: false,
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

