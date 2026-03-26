const mongoose = require("mongoose");

const publicHolidaySchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true,
      unique: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.PublicHoliday ||
  mongoose.model("PublicHoliday", publicHolidaySchema);

