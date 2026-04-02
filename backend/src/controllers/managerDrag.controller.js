const { runManagerDragTask } = require("../services/managerDragTask.service");

/**
 * PATCH /api/manager/drag-task
 * PROMPT 67 — Apply drag, manager override (weekend + flexible capacity), full scheduler (replacement, buffer, duration).
 */
const dragTask = async (req, res) => {
  try {
    const { contentId, stageName, newDate, allowWeekend } = req.body || {};
    const result = await runManagerDragTask({
      managerUserId: req.user.id,
      contentId,
      stageName,
      newDate,
      allowWeekend,
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
