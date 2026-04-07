/**
 * PROMPT 109 — Drop-in replacement for `managerRead.routes.js` to enable borrow-aware drag.
 * Usage: rename to `managerRead.routes.js` (backup original) or swap the drag controller require.
 */
const express = require("express");
const auth = require("../middleware/auth");
const roleGuard = require("../middleware/roleGuard");
const asyncHandler = require("../middleware/asyncHandler");
const managerReadController = require("../controllers/managerRead.controller");
const managerDragController = require("../controllers/managerDrag.controller.p109");
const managerLeaveController = require("../controllers/managerLeave.controller");

const router = express.Router();

router.use(auth, roleGuard(["manager", "admin"]));

router.get("/packages", managerReadController.getPackages);
router.post("/packages", asyncHandler(managerReadController.createManagerPackage));
router.get("/team-users", managerReadController.getTeamUsers);

router.patch("/drag-task", asyncHandler(managerDragController.dragTask));

router.post("/leaves", asyncHandler(managerLeaveController.createLeave));
router.get("/leaves", asyncHandler(managerLeaveController.listLeaves));

router.post("/leave", asyncHandler(managerLeaveController.createLeaveSimulatedConflict));

router.get("/leave", asyncHandler(managerLeaveController.getLeaves));

router.delete("/leave/:leaveId", asyncHandler(managerLeaveController.deleteLeave));

router.get("/global-calendar", asyncHandler(managerReadController.getManagerGlobalCalendarFinal));

module.exports = router;
