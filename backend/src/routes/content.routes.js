const express = require("express");
const auth = require("../middleware/auth");
const roleGuard = require("../middleware/roleGuard");
const asyncHandler = require("../middleware/asyncHandler");
const contentController = require("../controllers/content.controller");
const contentReadController = require("../controllers/contentRead.controller");

const router = express.Router();

router.get(
  "/share/:id",
  auth,
  asyncHandler(contentController.getSharedContentDetails)
);

router.get(
  "/:id",
  auth,
  asyncHandler(contentReadController.getContentById)
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

