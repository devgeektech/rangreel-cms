const express = require("express");
const auth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const userController = require("../controllers/user.controller");

const router = express.Router();

router.get("/me", auth, asyncHandler(userController.getMe));

module.exports = router;
