const express = require("express");
const auth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const contentReadController = require("../controllers/contentRead.controller");

const router = express.Router();

// Prompt 25: unified reel detail read API (includes strategist plan fields).
router.get("/:id", auth, asyncHandler(contentReadController.getContentById));

module.exports = router;

