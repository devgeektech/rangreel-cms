const express = require("express");
const auth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const userController = require("../controllers/user.controller");
const managerReadController = require("../controllers/managerRead.controller");
const managerLeaveController = require("../controllers/managerLeave.controller");

const router = express.Router();

router.get("/me", auth, asyncHandler(userController.getMe));

router.get("/my-tasks", auth, asyncHandler(userController.getMyTasks));
router.get("/clients/:id", auth, asyncHandler(userController.getTeamClient));
router.get("/global-calendar", auth, asyncHandler(userController.getStrategistGlobalCalendar));
router.get("/team-users", auth, asyncHandler(userController.getStrategistTeamUsers));
router.get("/team-capacity", auth, asyncHandler(userController.getStrategistTeamCapacity));
router.get("/leave", auth, asyncHandler(userController.getStrategistLeaves));
router.patch("/drag-task", auth, asyncHandler(userController.strategistDragTask));
router.patch(
  "/my-tasks/:itemId/:stageId",
  auth,
  asyncHandler(userController.updateMyTaskStatus)
);
router.get(
  "/strategist/global-calendar",
  auth,
  asyncHandler(managerReadController.getManagerGlobalCalendarFinal)
);
router.get(
  "/strategist/team-users",
  auth,
  asyncHandler(managerReadController.getTeamUsers)
);
router.get(
  "/strategist/team-capacity",
  auth,
  asyncHandler(managerReadController.getManagerTeamCapacity)
);
router.get(
  "/strategist/leave",
  auth,
  asyncHandler(managerLeaveController.getLeaves)
);
router.post(
  "/strategist/leave",
  auth,
  asyncHandler(managerLeaveController.createLeaveSimulatedConflict)
);
router.delete(
  "/strategist/leave/:leaveId",
  auth,
  asyncHandler(managerLeaveController.deleteLeave)
);
router.patch(
  "/strategist/drag-task",
  auth,
  asyncHandler(userController.strategistDragTask)
);

module.exports = router;
