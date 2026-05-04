const express = require("express");
const auth = require("../middleware/auth");
const roleGuard = require("../middleware/roleGuard");
const asyncHandler = require("../middleware/asyncHandler");
const contentReadController = require("../controllers/contentRead.controller");
const contentController = require("../controllers/content.controller");

const router = express.Router();

router.get(
  "/share/:id",
  auth,
  asyncHandler(contentController.getSharedContentDetails)
);

// Prompt 25: unified reel detail read API (includes strategist plan fields).
router.patch(
  "/:id/strategist-alias",
  auth,
  asyncHandler(contentReadController.patchStrategistAlias)
);
router.get("/:id", auth, asyncHandler(contentReadController.getContentById));
router.patch(
  "/:itemId/stage/:stageId/move",
  auth,
  roleGuard("manager"),
  asyncHandler(contentController.moveStage)
);

module.exports = router;

