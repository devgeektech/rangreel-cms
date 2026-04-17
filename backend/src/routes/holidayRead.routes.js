const express = require("express");
const auth = require("../middleware/auth");
const roleGuard = require("../middleware/roleGuard");
const holidayController = require("../controllers/holiday.controller");

const router = express.Router();

// Admin manages holidays; manager/strategist calendars read them.
router.use(auth, roleGuard(["manager", "admin", "user"]));
router.get("/", holidayController.getHolidays);

module.exports = router;
