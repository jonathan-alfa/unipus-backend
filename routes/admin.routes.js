const router = require("express").Router();
const { z } = require("zod");
const validated = require("../middleware/validate");
const { authenticate, authorize } = require("../middleware/auth.middleware");
const asyncHandler = require("../utils/asyncHandler");
const bookCtrl = require("../controllers/book.controller");
const catCtrl = require("../controllers/category.controller");
const loanCtrl = require("../controllers/loan.controller");
const userCtrl = require("../controllers/user.controller");
const dashCtrl = require("../controllers/dashboard.controller");
const { uploadBookCover } = require("../middleware/upload.middleware");

const optionalInt = z.preprocess(
  (val) => (val === "" || val === null || val === undefined ? undefined : val),
  z.coerce.number().int().positive().optional().nullable(),
);

const idParam = z.object({ id: z.coerce.number().int().positive() });

const categoryBody = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().optional().nullable(),
});

const createBookBody = z.object({
  category_id: optionalInt,
  title: z.string().trim().min(1).max(255),
  author: z.string().trim().max(255).optional().nullable(),
  publisher: z.string().trim().max(255).optional().nullable(),
  publication_year: z.preprocess(
    (val) =>
      val === "" || val === null || val === undefined ? undefined : val,
    z.coerce.number().int().min(1000).max(2100).optional().nullable(),
  ),
  isbn: z.string().trim().max(20).optional().nullable(),
  synopsis: z.string().trim().optional().nullable(),
  cover_book: z.string().trim().max(500).optional().nullable(),
  total_stock: z.coerce.number().int().min(0),
});

const updateBookBody = createBookBody.partial().extend({
  is_active: z.preprocess(
    (val) => (val === "true" ? true : val === "false" ? false : val),
    z.boolean().optional(),
  ),
});

const approveLoanBody = z.object({
  duration_days: z.number().int().min(1).max(90).optional(),
  due_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  require_pickup: z.boolean().optional(),
  note: z.string().trim().max(500).optional(),
});

const rejectLoanBody = z.object({
  note: z.string().trim().max(500).optional(),
});

const reviewNimBody = z.object({
  status: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(500).optional().nullable(),
});

const toggleStatusBody = z.object({
  is_active: z.boolean(),
});

const settingsBody = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean()]),
);

router.use(authenticate, authorize("admin"));

// Dashboard & Settings
router.get("/dashboard", asyncHandler(dashCtrl.getAdminDashboard));
router.get("/settings", asyncHandler(dashCtrl.getSettings));
router.put(
  "/settings",
  validated({ body: settingsBody }),
  asyncHandler(dashCtrl.updateSettings),
);

// Manajemen User & NIM
router.get(
  "/users",
  validated({
    query: z.object({
      nim_status: z.string().optional(),
      search: z.string().optional(),
    }),
  }),
  asyncHandler(userCtrl.getUsersAdmin),
);
router.patch(
  "/users/:id/nim-review",
  validated({ params: idParam, body: reviewNimBody }),
  asyncHandler(userCtrl.reviewUserNim),
);
router.patch(
  "/users/:id/status",
  validated({ params: idParam, body: toggleStatusBody }),
  asyncHandler(userCtrl.toggleUserStatus),
);

// Manajemen Kategori
router.post(
  "/categories",
  validated({ body: categoryBody }),
  asyncHandler(catCtrl.createCategory),
);
router.put(
  "/categories/:id",
  validated({ params: idParam, body: categoryBody.partial() }),
  asyncHandler(catCtrl.updateCategory),
);
router.delete(
  "/categories/:id",
  validated({ params: idParam }),
  asyncHandler(catCtrl.deleteCategory),
);

// Manajemen Buku
router.post(
  "/books",
  uploadBookCover.single("cover_book"),
  validated({ body: createBookBody }),
  asyncHandler(bookCtrl.createBook),
);
router.put(
  "/books/:id",
  uploadBookCover.single("cover_book"),
  validated({ params: idParam, body: updateBookBody }),
  asyncHandler(bookCtrl.updateBook),
);
router.delete(
  "/books/:id",
  validated({ params: idParam }),
  asyncHandler(bookCtrl.deleteBook),
);

// Manajemen Peminjaman & Pengembalian
router.get(
  "/loans",
  validated({
    query: z.object({
      status: z.string().optional(),
      search: z.string().optional(),
    }),
  }),
  asyncHandler(loanCtrl.getAllLoansAdmin),
);
router.patch(
  "/loans/:id/approve",
  validated({ params: idParam, body: approveLoanBody }),
  asyncHandler(loanCtrl.approveLoan),
);
router.patch(
  "/loans/:id/handover",
  validated({ params: idParam }),
  asyncHandler(loanCtrl.handoverLoan),
);
router.patch(
  "/loans/:id/reject",
  validated({ params: idParam, body: rejectLoanBody }),
  asyncHandler(loanCtrl.rejectLoan),
);
router.patch(
  "/loans/:id/confirm-return",
  validated({ params: idParam }),
  asyncHandler(loanCtrl.confirmReturn),
);

module.exports = router;
