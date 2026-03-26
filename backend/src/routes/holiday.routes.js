const express = require("express");
const auth = require("../middleware/auth");
const roleGuard = require("../middleware/roleGuard");
const holidayController = require("../controllers/holiday.controller");

const router = express.Router();

router.use(auth, roleGuard("admin"));

router.get("/", holidayController.getHolidays);
router.post("/", holidayController.createHoliday);
router.delete("/:id", holidayController.deleteHoliday);

module.exports = router;

