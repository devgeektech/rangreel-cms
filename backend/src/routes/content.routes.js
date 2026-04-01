const express = require("express");
const auth = require("../middleware/auth");
const roleGuard = require("../middleware/roleGuard");
const asyncHandler = require("../middleware/asyncHandler");
const contentController = require("../controllers/content.controller");

const router = express.Router();

router.get(
  "/:id",
  auth,
  asyncHandler(contentController.getContentById)
);

router.patch(
  "/:itemId/stage/:stageId",
  auth,
  roleGuard("manager"),
  asyncHandler(contentController.reshuffleStage)
);

router.patch(
  "/:itemId/stage/:stageId/status",
  auth,
  roleGuard("manager"),
  asyncHandler(contentController.updateStageStatus)
);

router.patch(
  "/:id/stages",
  auth,
  roleGuard("manager"),
  asyncHandler(contentController.patchContentItemStages)
);

module.exports = router;

