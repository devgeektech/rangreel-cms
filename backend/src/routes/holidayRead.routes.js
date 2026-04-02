const express = require("express");
const auth = require("../middleware/auth");
const roleGuard = require("../middleware/roleGuard");
const holidayController = require("../controllers/holiday.controller");

const router = express.Router();

// PROMPT 95: manager calendar reads holidays from admin-managed source.
router.use(auth, roleGuard(["manager", "admin"]));
router.get("/", holidayController.getHolidays);

module.exports = router;
