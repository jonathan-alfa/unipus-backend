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

const emptyToUndef = (val) =>
  val === "" || val === null || val === undefined ? undefined : val;

const optionalInt = z.preprocess(
  emptyToUndef,
  z.coerce.number().int().positive().optional().nullable(),
);

const idParam = z.object({ id: z.coerce.number().int().positive() });

const categoryBody = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().optional().nullable(),
});

const parseCopyCodes = z.preprocess(
  (val) => {
    if (!val) return [];
    if (Array.isArray(val))
      return val.map((v) => String(v).trim()).filter(Boolean);
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (!trimmed) return [];
      if (trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed);
          return Array.isArray(parsed)
            ? parsed.map((v) => String(v).trim()).filter(Boolean)
            : [];
        } catch {
          return [];
        }
      }
      return trimmed
        .split(/[\n,]+/)
        .map((v) => v.trim())
        .filter(Boolean);
    }
    return [];
  },
  z.array(z.string().min(1).max(100)),
);

const createBookBody = z.object({
  category_id: optionalInt,
  title: z.string().trim().min(1).max(255),
  author: z.string().trim().max(255).optional().nullable(),
  publisher: z.string().trim().max(255).optional().nullable(),
  publication_year: z.preprocess(
    emptyToUndef,
    z.coerce.number().int().min(1000).max(2100).optional().nullable(),
  ),
  isbn: z.preprocess(
    emptyToUndef,
    z.string().trim().max(20).optional().nullable(),
  ),
  synopsis: z.string().trim().optional().nullable(),
  cover_book: z.preprocess(
    emptyToUndef,
    z.string().trim().max(500).optional().nullable(),
  ),
  cover_image: z.preprocess(
    emptyToUndef,
    z.string().trim().max(500).optional().nullable(),
  ),
  total_stock: z.preprocess(
    emptyToUndef,
    z.coerce.number().int().min(1).optional(),
  ),
  available_stock: z.preprocess(
    emptyToUndef,
    z.coerce.number().int().min(0).optional(),
  ),
  copy_codes: parseCopyCodes.optional().default([]),
});

const updateBookBody = createBookBody.partial().extend({
  is_active: z.preprocess(
    (val) => (val === "true" ? true : val === "false" ? false : val),
    z.boolean().optional(),
  ),
  add_copy_codes: parseCopyCodes.optional(),
  remove_copy_codes: parseCopyCodes.optional(),
});

const approveLoanBody = z.object({
  duration_days: z.number().int().min(1).max(90).optional(),
  copy_codes: z.array(z.string().trim().min(1)).optional(),
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
router.get("/books/incomplete", asyncHandler(bookCtrl.getIncompleteBooks));

router.post(
  "/books",
  uploadBookCover.any(),
  validated({ body: createBookBody }),
  asyncHandler(bookCtrl.createBook),
);

router.put(
  "/books/:id",
  uploadBookCover.any(),
  validated({ params: idParam, body: updateBookBody }),
  asyncHandler(bookCtrl.updateBook),
);

router.patch(
  "/books/:id/assign-codes",
  validated({
    params: idParam,
    body: z.object({ copy_codes: parseCopyCodes }),
  }),
  asyncHandler(bookCtrl.assignCopyCodes),
);

router.patch(
  "/book-copies/:id",
  validated({
    params: idParam,
    body: z.object({
      copy_code: z.string().trim().min(1).max(100),
      status: z
        .enum(["available", "borrowed", "maintenance", "lost"])
        .optional(),
    }),
  }),
  asyncHandler(bookCtrl.updateBookCopy),
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
