const express = require("express");
const auth = require("../middleware/auth");
const roleGuard = require("../middleware/roleGuard");
const clientController = require("../controllers/client.controller");

const router = express.Router();

router.use(auth, roleGuard("manager"));

router.post("/", clientController.createClient);
router.get("/", clientController.getClients);
router.get("/global-calendar", clientController.getManagerGlobalCalendar);
router.get("/:id/client-calendar", clientController.getClientCalendar);
router.get("/:id/team-calendar", clientController.getTeamCalendar);
router.get("/:id", clientController.getClient);
router.patch("/:id/google-reviews", clientController.updateClientGoogleReviews);
router.patch("/:id", clientController.updateClient);

module.exports = router;

