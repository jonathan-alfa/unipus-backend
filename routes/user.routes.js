const router = require("express").Router();
const { z } = require("zod");
const validated = require("../middleware/validate");
const { authenticate, authorize } = require("../middleware/auth.middleware");
const asyncHandler = require("../utils/asyncHandler");
const userCtrl = require("../controllers/user.controller");
const dashCtrl = require("../controllers/dashboard.controller");

const idParam = z.object({ id: z.coerce.number().int().positive() });

const updateProfileBody = z.object({
  name: z.string().trim().min(2).max(150).optional(),
  current_password: z.string().min(1).optional(),
  new_password: z.string().min(8).max(100).optional(),
});

const submitNimBody = z.object({
  nim: z.string().trim().min(4).max(30),
});

router.use(authenticate);

router.get("/me", asyncHandler(userCtrl.getProfile));
router.put(
  "/me",
  validated({ body: updateProfileBody }),
  asyncHandler(userCtrl.updateProfile),
);
router.patch(
  "/me/nim",
  authorize("user"),
  validated({ body: submitNimBody }),
  asyncHandler(userCtrl.submitNim),
);
router.get(
  "/dashboard",
  authorize("user"),
  asyncHandler(dashCtrl.getUserDashboard),
);
router.get("/notifications", asyncHandler(userCtrl.getNotifications));
router.patch(
  "/notifications/read-all",
  asyncHandler(userCtrl.markAllNotificationsRead),
);
router.patch(
  "/notifications/:id/read",
  validated({ params: idParam }),
  asyncHandler(userCtrl.markNotificationRead),
);

module.exports = router;
