const express = require("express");
const auth = require("../middleware/auth");
const roleGuard = require("../middleware/roleGuard");
const managerReadController = require("../controllers/managerRead.controller");

const router = express.Router();

router.use(auth, roleGuard("manager"));

router.get("/packages", managerReadController.getPackages);
router.get("/team-users", managerReadController.getTeamUsers);

module.exports = router;

