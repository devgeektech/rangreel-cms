const express = require("express");
const auth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const contentController = require("../controllers/content.controller");

const router = express.Router();

// Prompt 25: unified reel detail read API.
router.get("/:id", auth, asyncHandler(contentController.getContentById));

module.exports = router;

