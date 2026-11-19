const router = require("express").Router();
const { z } = require("zod");
const validated = require("../middleware/validate");
const { authenticate } = require("../middleware/auth.middleware");
const asyncHandler = require("../utils/asyncHandler");
const auth = require("../controllers/auth.controller");

const registerBody = z.object({
  name: z.string().trim().min(2).max(150),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8).max(100),
  nim: z.string().trim().max(30).optional().nullable(),
});

const loginBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

router.post(
  "/register",
  validated({ body: registerBody }),
  asyncHandler(auth.register),
);
router.post("/login", validated({ body: loginBody }), asyncHandler(auth.login));
router.get("/me", authenticate, asyncHandler(auth.me));
router.post("/logout", authenticate, asyncHandler(auth.logout));

module.exports = router;
