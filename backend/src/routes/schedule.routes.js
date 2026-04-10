const express = require("express");
const auth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const scheduleController = require("../controllers/schedule.controller");

const router = express.Router();

router.get("/:clientId", auth, asyncHandler(scheduleController.getSchedules));
router.post("/create-next-month", auth, asyncHandler(scheduleController.createNextMonth));

module.exports = router;
