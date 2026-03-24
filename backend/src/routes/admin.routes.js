const express = require("express");
const auth = require("../middleware/auth");
const asyncHandler = require("../middleware/asyncHandler");
const roleGuard = require("../middleware/roleGuard");
const {
  createManagerValidation,
  createUserValidation,
} = require("../middleware/validation");
const adminController = require("../controllers/admin.controller");

const router = express.Router();

router.use(auth, roleGuard("admin"));

router.get("/roles", asyncHandler(adminController.getRoles));
router.post("/roles", asyncHandler(adminController.createRole));
router.put("/roles/:id", asyncHandler(adminController.updateRole));
router.delete("/roles/:id", asyncHandler(adminController.deleteRole));

router.get("/managers", asyncHandler(adminController.getManagers));
router.post(
  "/managers",
  createManagerValidation,
  asyncHandler(adminController.createManager)
);
router.put("/managers/:id", asyncHandler(adminController.updateManager));
router.put(
  "/managers/:id/reset-password",
  asyncHandler(adminController.resetManagerPassword)
);

router.get("/users", asyncHandler(adminController.getUsers));
router.post(
  "/users",
  createUserValidation,
  asyncHandler(adminController.createUser)
);
router.put("/users/:id", asyncHandler(adminController.updateUser));
router.put(
  "/users/:id/reset-password",
  asyncHandler(adminController.resetUserPassword)
);

module.exports = router;
