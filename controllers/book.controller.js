const pool = require("../db/connect");
const HttpError = require("../utils/httpError");
const { withTransaction } = require("../utils/transaction");
const { uploadToCloudinary } = require("../utils/cloudinary");

exports.getBooks = async (req, res) => {
  const {
    search,
    category_id,
    available_only,
    sort,
    order,
    page,
    limit,
    include_inactive,
  } = req.valid.query;
  const offset = (page - 1) * limit;

  const conditions = [];
  const params = [];

  if (!(include_inactive && req.user?.role === "admin")) {
    conditions.push("b.is_active = TRUE");
  }
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(
      `(LOWER(b.title) LIKE $${params.length} OR LOWER(b.author) LIKE $${params.length} OR LOWER(b.isbn) LIKE $${params.length})`,
    );
  }
  if (category_id) {
    params.push(category_id);
    conditions.push(`b.category_id = $${params.length}`);
  }
  if (available_only) {
    conditions.push("b.available_stock > 0");
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";
  const sortMap = {
    title: "b.title",
    publication_year: "b.publication_year",
    created_at: "b.created_at",
  };
  const sortCol = sortMap[sort] || "b.created_at";
  const sortDir = order === "asc" ? "ASC" : "DESC";

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS total FROM books b ${whereClause}`,
    params,
  );
  const total = countRes.rows[0].total;

  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT b.*,
            b.cover_book AS cover_image,
            c.name AS category_name,
            (b.available_stock > 0 AND b.is_active) AS is_available
     FROM books b
     LEFT JOIN categories c ON b.category_id = c.id
     ${whereClause}
     ORDER BY ${sortCol} ${sortDir}
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  res.json({
    books: rows,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
};

exports.getBookById = async (req, res) => {
  const { id } = req.valid.params;
  const { rows } = await pool.query(
    `SELECT b.*,
            b.cover_book AS cover_image,
            c.name AS category_name,
            (b.available_stock > 0 AND b.is_active) AS is_available
     FROM books b
     LEFT JOIN categories c ON b.category_id = c.id
     WHERE b.id = $1`,
    [id],
  );
  if (!rows.length) throw new HttpError(404, "Book not found");
  res.json({ book: rows[0] });
};

exports.createBook = async (req, res) => {
  const data = req.valid.body;

  // Cek req.file (jika pakai .single) atau req.files[0] (jika pakai .any)
  const file = req.file || (Array.isArray(req.files) && req.files[0]);

  let coverUrl = data.cover_book || data.cover_image || null;
  if (file) {
    const uploaded = await uploadToCloudinary(file.buffer);
    coverUrl = uploaded.secure_url;
  }

  const initialAvailable =
    data.available_stock !== undefined
      ? Math.min(data.available_stock, data.total_stock)
      : data.total_stock;

  const { rows } = await pool.query(
    `INSERT INTO books (category_id, title, author, publisher, publication_year, isbn, synopsis, cover_book, total_stock, available_stock)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *, cover_book AS cover_image`,
    [
      data.category_id ?? null,
      data.title,
      data.author ?? null,
      data.publisher ?? null,
      data.publication_year ?? null,
      data.isbn ?? null,
      data.synopsis ?? null,
      coverUrl, // <-- Pastikan pakai coverUrl, bukan data.cover_book
      data.total_stock,
      initialAvailable,
    ],
  );

  await pool.query(
    `INSERT INTO activity_logs (user_id, action, entity_type, entity_id, metadata)
     VALUES ($1, 'CREATE_BOOK', 'books', $2, $3)`,
    [req.user.id, rows[0].id, JSON.stringify({ title: rows[0].title })],
  );

  res.status(201).json({ message: "Book created", book: rows[0] });
};

exports.updateBook = async (req, res) => {
  const { id } = req.valid.params;
  const data = req.valid.body;
  const file = req.file || (Array.isArray(req.files) && req.files[0]);

  let uploadedCoverUrl = null;
  if (file) {
    const uploaded = await uploadToCloudinary(file.buffer);
    uploadedCoverUrl = uploaded.secure_url;
  }

  const book = await withTransaction(async (client) => {
    const { rows: existing } = await client.query(
      "SELECT * FROM books WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!existing.length) throw new HttpError(404, "Book not found");

    const current = existing[0];
    const borrowedCount = current.total_stock - current.available_stock;
    const newTotal =
      data.total_stock !== undefined ? data.total_stock : current.total_stock;

    if (newTotal < borrowedCount) {
      throw new HttpError(
        400,
        `Total stock cannot be less than currently borrowed copies (${borrowedCount})`,
      );
    }
    const newAvailable = newTotal - borrowedCount;
    const finalCover =
      uploadedCoverUrl || data.cover_book || data.cover_image || null;

    const { rows } = await client.query(
      `UPDATE books SET
        category_id = COALESCE($1, category_id),
        title = COALESCE($2, title),
        author = COALESCE($3, author),
        publisher = COALESCE($4, publisher),
        publication_year = COALESCE($5, publication_year),
        isbn = COALESCE($6, isbn),
        synopsis = COALESCE($7, synopsis),
        cover_book = COALESCE($8, cover_book),
        is_active = COALESCE($9, is_active),
        total_stock = $10,
        available_stock = $11
       WHERE id = $12 RETURNING *, cover_book AS cover_image`,
      [
        data.category_id ?? null,
        data.title ?? null,
        data.author ?? null,
        data.publisher ?? null,
        data.publication_year ?? null,
        data.isbn ?? null,
        data.synopsis ?? null,
        finalCover,
        data.is_active ?? null,
        newTotal,
        newAvailable,
        id,
      ],
    );
    return rows[0];
  });

  res.json({ message: "Book updated", book });
};
