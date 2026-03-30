const express = require("express");
const auth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const internalCalendarController = require("../controllers/internalCalendar.controller");

const router = express.Router();

router.get("/:clientId", auth, asyncHandler(internalCalendarController.getInternalCalendar));
router.patch("/update", auth, asyncHandler(internalCalendarController.updateInternalCalendarStage));

module.exports = router;

