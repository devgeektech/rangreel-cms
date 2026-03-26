const express = require("express");
const auth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const userController = require("../controllers/user.controller");

const router = express.Router();

router.get("/me", auth, asyncHandler(userController.getMe));

router.get("/my-tasks", auth, asyncHandler(userController.getMyTasks));
router.patch(
  "/my-tasks/:itemId/:stageId",
  auth,
  asyncHandler(userController.updateMyTaskStatus)
);

module.exports = router;
