const Client = require("../models/Client");
const {
  listSchedulesForClient,
  createNextMonthSchedule,
  extendSchedules,
  previewExtendSchedules,
  saveExtendedSchedules,
} = require("../services/clientScheduleMonths.service");

const success = (res, data, statusCode = 200) =>
  res.status(statusCode).json({ success: true, data });

const failure = (res, error, statusCode = 400) =>
  res.status(statusCode).json({ success: false, error });

const getSchedules = async (req, res) => {
  try {
    const { clientId } = req.params;
    const allowed = await Client.exists({ _id: clientId, manager: req.user.id });
    if (!allowed) {
      return failure(res, "Client not found or access denied", 403);
    }
    const data = await listSchedulesForClient(clientId);
    return success(res, data);
  } catch (err) {
    return failure(res, err.message || "Failed to load schedules", 500);
  }
};

const createNextMonth = async (req, res) => {
  try {
    const clientId = req.body?.clientId || req.params?.clientId;
    if (!clientId) {
      return failure(res, "clientId is required", 400);
    }
    const doc = await createNextMonthSchedule(clientId, req.user.id);
    const payload = await listSchedulesForClient(clientId);
    return success(res, { newSchedule: doc, ...payload });
  } catch (err) {
    return failure(res, err.message || "Failed to create next month", 400);
  }
};

const extendSchedule = async (req, res) => {
  try {
    if (req.user?.roleType !== "manager") {
      return failure(res, "Unauthorized", 403);
    }
    const { clientId, numberOfCycles, startMonthIndex } = req.body || {};
    if (!clientId) return failure(res, "clientId is required", 400);
    if (!Number.isFinite(Number(numberOfCycles)) || Number(numberOfCycles) <= 0) {
      return failure(res, "numberOfCycles must be a positive number", 400);
    }
    const schedules = await extendSchedules(clientId, req.user.id, Number(numberOfCycles), {
      startMonthIndex,
    });
    return success(res, { schedules, isDraftMode: true });
  } catch (err) {
    return failure(res, err.message || "Failed to extend schedule", 400);
  }
};

const previewExtend = async (req, res) => {
  try {
    if (req.user?.roleType !== "manager") {
      return failure(res, "Unauthorized", 403);
    }
    const { clientId, numberOfCycles, startMonthIndex } = req.body || {};
    if (!clientId) return failure(res, "clientId is required", 400);
    if (!Number.isFinite(Number(numberOfCycles)) || Number(numberOfCycles) <= 0) {
      return failure(res, "numberOfCycles must be a positive number", 400);
    }
    const schedules = await previewExtendSchedules(clientId, req.user.id, Number(numberOfCycles), {
      startMonthIndex,
    });
    return success(res, { schedules });
  } catch (err) {
    return failure(res, err.message || "Failed to preview schedule extension", 400);
  }
};

const saveSchedule = async (req, res) => {
  try {
    if (req.user?.roleType !== "manager") {
      return failure(res, "Unauthorized", 403);
    }
    const { clientId, schedules } = req.body || {};
    if (!clientId) return failure(res, "clientId is required", 400);
    await saveExtendedSchedules(clientId, req.user.id, schedules);
    const payload = await listSchedulesForClient(clientId);
    return success(res, payload);
  } catch (err) {
    return failure(res, err.message || "Failed to save schedule", 400);
  }
};

module.exports = {
  getSchedules,
  createNextMonth,
  extendSchedule,
  previewExtend,
  saveSchedule,
};
