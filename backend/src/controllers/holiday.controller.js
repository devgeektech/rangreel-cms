const PublicHoliday = require("../models/PublicHoliday");

const success = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

const failure = (res, error, statusCode = 400) =>
  res.status(statusCode).json({ success: false, error });

const normalizeDateToUtcMidnight = (value) => {
  if (!value) return null;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  if (typeof value === "string") {
    // Expecting date-only like "2025-10-02"
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const year = Number(m[1]);
      const month = Number(m[2]);
      const day = Number(m[3]);
      return new Date(Date.UTC(year, month - 1, day));
    }

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  return null;
};

const getHolidays = async (req, res) => {
  try {
    const holidays = await PublicHoliday.find().sort({ date: 1 });
    return success(res, holidays);
  } catch (err) {
    return failure(res, "Failed to fetch holidays", 500);
  }
};

const createHoliday = async (req, res) => {
  try {
    const { date, title } = req.body;

    if (!date || !title) {
      return failure(res, "date and title are required", 400);
    }

    const normalizedDate = normalizeDateToUtcMidnight(date);
    if (!normalizedDate) {
      return failure(res, "Invalid date format", 400);
    }

    const existing = await PublicHoliday.findOne({ date: normalizedDate });
    if (existing) {
      return failure(res, "Holiday already exists for this date", 400);
    }

    const holiday = await PublicHoliday.create({
      date: normalizedDate,
      title: String(title).trim(),
      createdBy: req.user.id,
    });

    return success(res, holiday, 201);
  } catch (err) {
    // Unique index guard
    if (err && err.code === 11000) {
      return failure(res, "Holiday already exists for this date", 400);
    }
    return failure(res, "Failed to create holiday", 500);
  }
};

const deleteHoliday = async (req, res) => {
  try {
    const { id } = req.params;

    const holiday = await PublicHoliday.findById(id);
    if (!holiday) {
      return failure(res, "Holiday not found", 404);
    }

    await holiday.deleteOne();
    return success(res, { message: "Holiday deleted successfully" });
  } catch (err) {
    return failure(res, "Failed to delete holiday", 500);
  }
};

module.exports = {
  getHolidays,
  createHoliday,
  deleteHoliday,
};

