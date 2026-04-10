const Client = require("../models/Client");
const {
  listSchedulesForClient,
  createNextMonthSchedule,
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

module.exports = {
  getSchedules,
  createNextMonth,
};
