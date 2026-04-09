/**
 * PROMPT 109 — PATCH /api/manager/drag-task with borrow-aware sequence handling.
 * Wire: point `managerRead.routes.js` at this controller instead of `managerDrag.controller.js`,
 * or merge the require path change.
 */
const { runManagerDragTask } = require("../services/managerDragTask.service.p109");

const dragTask = async (req, res) => {
  try {
    const { contentId, stageName, newDate, allowWeekend, fromGlobalCalendar, targetUserId } =
      req.body || {};
    const result = await runManagerDragTask({
      managerUserId: req.user.id,
      contentId,
      stageName,
      newDate,
      allowWeekend,
      fromGlobalCalendar: fromGlobalCalendar === true,
      targetUserId,
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({
        success: false,
        error: result.error,
        details: result.details,
      });
    }
    return res.status(200).json({ success: true, data: result.data });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || "Drag task failed",
    });
  }
};

module.exports = {
  dragTask,
};
