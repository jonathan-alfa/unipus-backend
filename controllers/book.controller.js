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

    conditions.push(
      `EXISTS (
        SELECT 1 FROM book_copies bc_pub
        WHERE bc_pub.book_id = b.id AND bc_pub.status <> 'pending_code'
      )`,
    );
  }

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(
      `(LOWER(b.title) LIKE $${params.length}
        OR LOWER(b.author) LIKE $${params.length}
        OR LOWER(b.isbn) LIKE $${params.length}
        OR EXISTS (
          SELECT 1 FROM book_copies bc_s
          WHERE bc_s.book_id = b.id AND LOWER(bc_s.copy_code) LIKE $${params.length}
        ))`,
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
            (b.available_stock > 0 AND b.is_active) AS is_available,
            COUNT(bc.id) FILTER (WHERE bc.status <> 'pending_code')::int AS coded_count,
            COUNT(bc.id) FILTER (WHERE bc.status = 'pending_code')::int AS pending_count,
            COALESCE(
              json_agg(
                json_build_object('id', bc.id, 'copy_code', bc.copy_code, 'status', bc.status)
                ORDER BY bc.id ASC
              ) FILTER (WHERE bc.id IS NOT NULL),
              '[]'
            ) AS copies
     FROM books b
     LEFT JOIN categories c ON b.category_id = c.id
     LEFT JOIN book_copies bc ON bc.book_id = b.id
     ${whereClause}
     GROUP BY b.id, c.name
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
            (b.available_stock > 0 AND b.is_active) AS is_available,
            COUNT(bc.id) FILTER (WHERE bc.status <> 'pending_code')::int AS coded_count,
            COUNT(bc.id) FILTER (WHERE bc.status = 'pending_code')::int AS pending_count,
            COALESCE(
              json_agg(
                json_build_object('id', bc.id, 'copy_code', bc.copy_code, 'status', bc.status)
                ORDER BY bc.id ASC
              ) FILTER (WHERE bc.id IS NOT NULL),
              '[]'
            ) AS copies
     FROM books b
     LEFT JOIN categories c ON b.category_id = c.id
     LEFT JOIN book_copies bc ON bc.book_id = b.id
     WHERE b.id = $1
     GROUP BY b.id, c.name`,
    [id],
  );

  if (!rows.length) throw new HttpError(404, "Book not found");
  res.json({ book: rows[0] });
};

exports.createBook = async (req, res) => {
  const data = req.valid.body;
  const uniqueCodes = [
    ...new Set((data.copy_codes || []).map((c) => c.trim()).filter(Boolean)),
  ];
  const finalTotalStock = data.total_stock ?? uniqueCodes.length;

  if (!finalTotalStock || finalTotalStock < 1) {
    throw new HttpError(400, "Isi total_stock minimal 1");
  }
  if (uniqueCodes.length > finalTotalStock) {
    throw new HttpError(
      400,
      `Jumlah kode buku (${uniqueCodes.length}) melebihi total stok (${finalTotalStock})`,
    );
  }

  const file = req.file || (Array.isArray(req.files) && req.files[0]);
  let coverUrl = data.cover_book || data.cover_image || null;
  if (file) {
    const uploaded = await uploadToCloudinary(file.buffer);
    coverUrl = uploaded.secure_url;
  }

  const createdBook = await withTransaction(async (client) => {
    if (uniqueCodes.length > 0) {
      const dupCheck = await client.query(
        `SELECT copy_code FROM book_copies WHERE LOWER(copy_code) = ANY($1::text[])`,
        [uniqueCodes.map((c) => c.toLowerCase())],
      );
      if (dupCheck.rows.length > 0) {
        throw new HttpError(
          409,
          `Kode buku sudah terdaftar: ${dupCheck.rows.map((r) => r.copy_code).join(", ")}`,
        );
      }
    }

    const initialAvailable = uniqueCodes.length;

    const { rows } = await client.query(
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
        coverUrl,
        finalTotalStock,
        initialAvailable,
      ],
    );
    const book = rows[0];

    const insertedCopies = [];
    for (let i = 0; i < finalTotalStock; i++) {
      const code = uniqueCodes[i] || null;
      const status = code ? "available" : "pending_code";
      const copyRes = await client.query(
        `INSERT INTO book_copies (book_id, copy_code, status)
         VALUES ($1, $2, $3)
         RETURNING id, copy_code, status`,
        [book.id, code, status],
      );
      insertedCopies.push(copyRes.rows[0]);
    }

    await client.query(
      `INSERT INTO activity_logs (user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'CREATE_BOOK', 'books', $2, $3)`,
      [
        req.user.id,
        book.id,
        JSON.stringify({
          title: book.title,
          total_stock: finalTotalStock,
          coded_stock: initialAvailable,
          pending_stock: finalTotalStock - initialAvailable,
        }),
      ],
    );

    return {
      ...book,
      coded_count: initialAvailable,
      pending_count: finalTotalStock - initialAvailable,
      is_published_to_catalog: initialAvailable > 0,
      copies: insertedCopies,
    };
  });

  res.status(201).json({ message: "Book created", book: createdBook });
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

    if (Array.isArray(data.add_copy_codes) && data.add_copy_codes.length > 0) {
      const uniqueAdd = [
        ...new Set(data.add_copy_codes.map((c) => c.trim()).filter(Boolean)),
      ];
      const dupCheck = await client.query(
        `SELECT copy_code FROM book_copies WHERE LOWER(copy_code) = ANY($1::text[])`,
        [uniqueAdd.map((c) => c.toLowerCase())],
      );
      if (dupCheck.rows.length > 0) {
        throw new HttpError(
          409,
          `Kode buku sudah terdaftar: ${dupCheck.rows.map((r) => r.copy_code).join(", ")}`,
        );
      }
      for (const code of uniqueAdd) {
        await client.query(
          `INSERT INTO book_copies (book_id, copy_code, status) VALUES ($1, $2, 'available')`,
          [id, code],
        );
      }
    }

    if (
      Array.isArray(data.remove_copy_codes) &&
      data.remove_copy_codes.length > 0
    ) {
      for (const code of data.remove_copy_codes) {
        const copyRes = await client.query(
          `SELECT id, status FROM book_copies WHERE book_id = $1 AND LOWER(copy_code) = LOWER($2) FOR UPDATE`,
          [id, code],
        );
        if (!copyRes.rows.length) {
          throw new HttpError(
            404,
            `Kode buku "${code}" tidak ditemukan pada buku ini`,
          );
        }
        if (copyRes.rows[0].status === "borrowed") {
          throw new HttpError(
            400,
            `Kode buku "${code}" sedang dipinjam dan tidak dapat dihapus`,
          );
        }
        await client.query(`DELETE FROM book_copies WHERE id = $1`, [
          copyRes.rows[0].id,
        ]);
      }
    }

    if (data.total_stock !== undefined) {
      const currentCopiesRes = await client.query(
        `SELECT id, status FROM book_copies WHERE book_id = $1 ORDER BY id DESC FOR UPDATE`,
        [id],
      );
      const currentCount = currentCopiesRes.rows.length;
      const borrowedCount = currentCopiesRes.rows.filter(
        (c) => c.status === "borrowed",
      ).length;

      if (data.total_stock < borrowedCount) {
        throw new HttpError(
          400,
          `Total stok tidak boleh kurang dari jumlah buku yang sedang dipinjam (${borrowedCount})`,
        );
      }

      if (data.total_stock > currentCount) {
        const diff = data.total_stock - currentCount;
        for (let i = 0; i < diff; i++) {
          await client.query(
            `INSERT INTO book_copies (book_id, copy_code, status) VALUES ($1, NULL, 'pending_code')`,
            [id],
          );
        }
      } else if (data.total_stock < currentCount) {
        let toRemove = currentCount - data.total_stock;
        // Hapus yang pending_code dulu, baru available jika masih kurang
        const removable = [
          ...currentCopiesRes.rows.filter((c) => c.status === "pending_code"),
          ...currentCopiesRes.rows.filter((c) => c.status === "available"),
        ];
        if (removable.length < toRemove) {
          throw new HttpError(
            400,
            "Stok tidak bisa dikurangi karena eksemplar lainnya sedang dipinjam",
          );
        }
        for (let i = 0; i < toRemove; i++) {
          await client.query(`DELETE FROM book_copies WHERE id = $1`, [
            removable[i].id,
          ]);
        }
      }
    }

    // 4. Hitung ulang total_stock & available_stock dari book_copies
    const countRes = await client.query(
      `SELECT
        COUNT(*)::int AS total_stock,
        COUNT(*) FILTER (WHERE status = 'available')::int AS available_stock
       FROM book_copies WHERE book_id = $1`,
      [id],
    );
    const { total_stock, available_stock } = countRes.rows[0];
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
        total_stock,
        available_stock,
        id,
      ],
    );

    const copiesRes = await client.query(
      `SELECT id, copy_code, status FROM book_copies WHERE book_id = $1 ORDER BY id ASC`,
      [id],
    );

    return {
      ...rows[0],
      coded_count: copiesRes.rows.filter((c) => c.status !== "pending_code")
        .length,
      pending_count: copiesRes.rows.filter((c) => c.status === "pending_code")
        .length,
      copies: copiesRes.rows,
    };
  });

  res.json({ message: "Book updated", book });
};

exports.deleteBook = async (req, res) => {
  const { id } = req.valid.params;

  await withTransaction(async (client) => {
    const { rows: existing } = await client.query(
      "SELECT id, title FROM books WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!existing.length) throw new HttpError(404, "Book not found");

    const activeLoanRes = await client.query(
      `SELECT 1 FROM loan_items li
       JOIN loans l ON li.loan_id = l.id
       JOIN loan_statuses ls ON l.status_id = ls.id
       WHERE li.book_id = $1 AND ls.code IN ('pending', 'approved', 'borrowed', 'return_requested')
       LIMIT 1`,
      [id],
    );
    if (activeLoanRes.rows.length) {
      throw new HttpError(
        400,
        "Buku tidak dapat dihapus karena masih memiliki transaksi peminjaman aktif",
      );
    }

    const historyRes = await client.query(
      `SELECT 1 FROM loan_items WHERE book_id = $1 LIMIT 1`,
      [id],
    );
    if (historyRes.rows.length) {
      // Soft delete jika sudah punya riwayat peminjaman
      await client.query(`UPDATE books SET is_active = FALSE WHERE id = $1`, [
        id,
      ]);
    } else {
      await client.query(`DELETE FROM books WHERE id = $1`, [id]);
    }
  });

  res.json({ message: "Book deleted" });
};

exports.getIncompleteBooks = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT b.id,
            b.title,
            b.author,
            b.publisher,
            b.publication_year,
            b.cover_book,
            b.cover_book AS cover_image,
            c.name AS category_name,
            b.total_stock,
            b.available_stock,
            COUNT(bc.id) FILTER (WHERE bc.status <> 'pending_code')::int AS coded_count,
            COUNT(bc.id) FILTER (WHERE bc.status = 'pending_code')::int AS pending_count,
            json_agg(
              json_build_object('id', bc.id, 'copy_code', bc.copy_code, 'status', bc.status)
              ORDER BY bc.id ASC
            ) AS copies
     FROM books b
     LEFT JOIN categories c ON b.category_id = c.id
     JOIN book_copies bc ON bc.book_id = b.id
     GROUP BY b.id, c.name
     HAVING COUNT(bc.id) FILTER (WHERE bc.status = 'pending_code') > 0
     ORDER BY b.created_at DESC`,
  );

  res.json({
    total_incomplete_books: rows.length,
    books: rows,
  });
};

exports.assignCopyCodes = async (req, res) => {
  const { id } = req.valid.params;
  const { copy_codes } = req.valid.body;

  const uniqueCodes = [
    ...new Set((copy_codes || []).map((c) => c.trim()).filter(Boolean)),
  ];
  if (!uniqueCodes.length) {
    throw new HttpError(400, "Masukkan minimal 1 kode buku");
  }

  const updatedBook = await withTransaction(async (client) => {
    const bookRes = await client.query(
      `SELECT id, title FROM books WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!bookRes.rows.length) throw new HttpError(404, "Buku tidak ditemukan");

    const dupCheck = await client.query(
      `SELECT copy_code FROM book_copies WHERE LOWER(copy_code) = ANY($1::text[])`,
      [uniqueCodes.map((c) => c.toLowerCase())],
    );
    if (dupCheck.rows.length > 0) {
      throw new HttpError(
        409,
        `Kode buku sudah terdaftar: ${dupCheck.rows.map((r) => r.copy_code).join(", ")}`,
      );
    }

    const pendingRes = await client.query(
      `SELECT id FROM book_copies
       WHERE book_id = $1 AND status = 'pending_code'
       ORDER BY id ASC
       FOR UPDATE`,
      [id],
    );

    if (uniqueCodes.length > pendingRes.rows.length) {
      throw new HttpError(
        400,
        `Jumlah kode (${uniqueCodes.length}) melebihi sisa eksemplar yang belum berkode (${pendingRes.rows.length})`,
      );
    }

    for (let i = 0; i < uniqueCodes.length; i++) {
      await client.query(
        `UPDATE book_copies
         SET copy_code = $1, status = 'available'
         WHERE id = $2`,
        [uniqueCodes[i], pendingRes.rows[i].id],
      );
    }

    const { rows } = await client.query(
      `UPDATE books
       SET available_stock = (
         SELECT COUNT(*)::int FROM book_copies WHERE book_id = $1 AND status = 'available'
       )
       WHERE id = $1
       RETURNING *, cover_book AS cover_image`,
      [id],
    );

    const copiesRes = await client.query(
      `SELECT id, copy_code, status FROM book_copies WHERE book_id = $1 ORDER BY id ASC`,
      [id],
    );

    await client.query(
      `INSERT INTO activity_logs (user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'ASSIGN_COPY_CODES', 'books', $2, $3)`,
      [req.user.id, id, JSON.stringify({ assigned_codes: uniqueCodes })],
    );

    return {
      ...rows[0],
      coded_count: copiesRes.rows.filter((c) => c.status !== "pending_code")
        .length,
      pending_count: copiesRes.rows.filter((c) => c.status === "pending_code")
        .length,
      copies: copiesRes.rows,
    };
  });

  res.json({ message: "Kode eksemplar berhasil disimpan", book: updatedBook });
};

exports.updateBookCopy = async (req, res) => {
  const { id } = req.valid.params;
  const { copy_code, status } = req.valid.body;

  const updatedCopy = await withTransaction(async (client) => {
    const dupCheck = await client.query(
      `SELECT copy_code FROM book_copies WHERE LOWER(copy_code) = LOWER($1) AND id <> $2`,
      [copy_code.trim(), id],
    );
    if (dupCheck.rows.length > 0) {
      throw new HttpError(
        409,
        `Kode buku "${copy_code.trim()}" sudah digunakan`,
      );
    }

    const { rows } = await client.query(
      `UPDATE book_copies
       SET copy_code = $1,
           status = COALESCE($2, status)
       WHERE id = $3
       RETURNING *`,
      [copy_code.trim(), status ?? null, id],
    );

    if (!rows.length)
      throw new HttpError(404, "Kode eksemplar buku tidak ditemukan");

    const bookId = rows[0].book_id;
    await client.query(
      `UPDATE books
       SET total_stock = (SELECT COUNT(*)::int FROM book_copies WHERE book_id = $1),
           available_stock = (SELECT COUNT(*)::int FROM book_copies WHERE book_id = $1 AND status = 'available')
       WHERE id = $1`,
      [bookId],
    );

    return rows[0];
  });

  res.json({ message: "Kode eksemplar diperbarui", copy: updatedCopy });
};
