const express = require("express");
const auth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const calendarController = require("../controllers/calendar.controller");

const router = express.Router();

router.post("/check-conflicts", auth, asyncHandler(calendarController.checkConflicts));
router.post(
  "/preview-stages-from-posting",
  auth,
  asyncHandler(calendarController.previewStagesFromPosting)
);

module.exports = router;
