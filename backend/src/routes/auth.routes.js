const express = require("express");
const auth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const { loginValidation } = require("../middleware/validation");
const authController = require("../controllers/auth.controller");

const router = express.Router();

router.post("/login", loginValidation, asyncHandler(authController.login));
router.post("/logout", asyncHandler(authController.logout));
router.post("/change-password", auth, asyncHandler(authController.changePassword));

module.exports = router;
