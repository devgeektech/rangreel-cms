const express = require("express");
const auth = require("../middleware/auth");
const roleGuard = require("../middleware/roleGuard");
const packageController = require("../controllers/package.controller");

const router = express.Router();

router.use(auth);
router.use(roleGuard("admin"));

router.get("/", packageController.getPackages);
router.post("/", packageController.createPackage);
router.patch("/:id", packageController.updatePackage);
router.delete("/:id", packageController.deletePackage);

module.exports = router;
