const express = require("express");
const auth = require("../middleware/auth");
const roleGuard = require("../middleware/roleGuard");
const asyncHandler = require("../middleware/asyncHandler");
const managerReadController = require("../controllers/managerRead.controller");
const managerDragController = require("../controllers/managerDrag.controller");
const managerLeaveController = require("../controllers/managerLeave.controller");

const router = express.Router();

router.use(auth, roleGuard(["manager", "admin"]));

router.get("/packages", managerReadController.getPackages);
router.post("/packages", asyncHandler(managerReadController.createManagerPackage));
router.get("/team-users", managerReadController.getTeamUsers);
router.get("/team-capacity", asyncHandler(managerReadController.getManagerTeamCapacity));

/** PROMPT 67 — Enhanced manager drag (scheduler: replacement, buffer, duration, weekend). */
router.patch("/drag-task", asyncHandler(managerDragController.dragTask));

/** PROMPT 71 — Leave system (manager controlled). */
router.post("/leaves", asyncHandler(managerLeaveController.createLeave));
router.get("/leaves", asyncHandler(managerLeaveController.listLeaves));

/** PROMPT 74 — Manager add leave with scheduling conflict simulation. */
router.post("/leave", asyncHandler(managerLeaveController.createLeaveSimulatedConflict));

/** PROMPT 75 — GET leave for UI/calendar display. */
router.get("/leave", asyncHandler(managerLeaveController.getLeaves));

/** PROMPT 76 — DELETE leave (no immediate reschedule needed). */
router.delete("/leave/:leaveId", asyncHandler(managerLeaveController.deleteLeave));

/** PROMPT 72 — Final manager view (multi-day global calendar). */
router.get("/global-calendar", asyncHandler(managerReadController.getManagerGlobalCalendarFinal));

module.exports = router;

