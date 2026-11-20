const router = require("express").Router();
const { z } = require("zod");
const validated = require("../middleware/validate");
const { authenticate, authorize } = require("../middleware/auth.middleware");
const asyncHandler = require("../utils/asyncHandler");
const loanCtrl = require("../controllers/loan.controller");

const idParam = z.object({ id: z.coerce.number().int().positive() });

const createLoanBody = z.object({
  book_ids: z.array(z.coerce.number().int().positive()).min(1),
  notes: z.string().trim().max(500).optional().nullable(),
});

const myLoansQuery = z.object({
  status: z
    .preprocess(
      (val) => (val === "return_requested" ? "return_request" : val),
      z.enum([
        "pending",
        "approved",
        "borrowed",
        "return_request",
        "returned",
        "rejected",
        "cancelled",
        "overdue",
      ]),
    )
    .optional(),
});

router.use(authenticate);

router.post(
  "/",
  authorize("user"),
  validated({ body: createLoanBody }),
  asyncHandler(loanCtrl.createLoan),
);
router.get(
  "/my",
  authorize("user"),
  validated({ query: myLoansQuery }),
  asyncHandler(loanCtrl.getMyLoans),
);
router.get(
  "/:id",
  validated({ params: idParam }),
  asyncHandler(loanCtrl.getLoanDetail),
);
router.patch(
  "/:id/cancel",
  authorize("user"),
  validated({ params: idParam }),
  asyncHandler(loanCtrl.cancelLoan),
);
router.patch(
  "/:id/return-request",
  authorize("user"),
  validated({ params: idParam }),
  asyncHandler(loanCtrl.requestReturn),
);

module.exports = router;
