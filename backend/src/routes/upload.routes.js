const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const auth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const uploadController = require("../controllers/upload.controller");

const router = express.Router();

const uploadDir = path.join(__dirname, "..", "..", "temp", "videos");
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const safeExt = ext && ext.length <= 10 ? ext : "";
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `video-${unique}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB
  },
});

router.post(
  "/video",
  auth,
  upload.single("file"),
  asyncHandler(uploadController.uploadVideo)
);

module.exports = router;

