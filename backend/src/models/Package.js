const mongoose = require("mongoose");

const packageSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    noOfReels: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    noOfStaticPosts: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    noOfPosts: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    noOfCarousels: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    noOfGoogleReviews: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    gmbPosting: {
      type: Boolean,
      required: true,
      default: false,
    },
    campaignManagement: {
      type: Boolean,
      required: true,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    /** Who created this package — used for manager vs global (admin) listing. */
    createdByRole: {
      type: String,
      enum: ["admin", "manager"],
      default: "manager",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Package", packageSchema);
