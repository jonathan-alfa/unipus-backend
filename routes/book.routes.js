const router = require("express").Router();
const { z } = require("zod");
const validated = require("../middleware/validate");
const { optionalAuth } = require("../middleware/auth.middleware");
const asyncHandler = require("../utils/asyncHandler");
const bookCtrl = require("../controllers/book.controller");
const catCtrl = require("../controllers/category.controller");

const idParam = z.object({ id: z.coerce.number().int().positive() });

const listBooksQuery = z.object({
  search: z.string().trim().optional(),
  category_id: z.coerce.number().int().positive().optional(),
  available_only: z.coerce.boolean().optional(),
  include_inactive: z.coerce.boolean().optional(),
  sort: z
    .enum(["title", "publication_year", "created_at"])
    .default("created_at"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(12),
});

router.get("/categories", asyncHandler(catCtrl.getCategories));
router.get(
  "/books",
  optionalAuth,
  validated({ query: listBooksQuery }),
  asyncHandler(bookCtrl.getBooks),
);
router.get(
  "/books/:id",
  validated({ params: idParam }),
  asyncHandler(bookCtrl.getBookById),
);

module.exports = router;
