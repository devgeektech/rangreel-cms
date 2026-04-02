const express = require("express");
const auth = require("../middleware/auth");
const roleGuard = require("../middleware/roleGuard");
const asyncHandler = require("../middleware/asyncHandler");
const { uploadBriefFields } = require("../multer/clientBriefUpload");
const clientController = require("../controllers/client.controller");

const router = express.Router();

router.use(auth, roleGuard("manager"));

router.post("/", clientController.createClient);
router.get("/", clientController.getClients);
router.get("/global-calendar", clientController.getManagerGlobalCalendar);
router.post(
  "/:id/brief-assets",
  (req, res, next) => {
    uploadBriefFields(req, res, (err) => {
      if (err) return next(err);
      next();
    });
  },
  asyncHandler(clientController.appendClientBriefAssets)
);
router.get(
  "/:id/brief-assets/:fileId/download",
  asyncHandler(clientController.downloadClientBriefAsset)
);
router.patch("/:id/google-reviews", clientController.updateClientGoogleReviews);
router.get("/:id", clientController.getClient);
router.patch("/:id", clientController.updateClient);

module.exports = router;

