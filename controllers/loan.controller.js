const pool = require("../db/connect");
const HttpError = require("../utils/httpError");
const { withTransaction } = require("../utils/transaction");

exports.createLoan = async (req, res) => {
  const { book_ids, notes } = req.valid.body;
  const uniqueBookIds = [...new Set(book_ids)];

  const loan = await withTransaction(async (client) => {
    const settingsRes = await client.query(
      "SELECT key, value FROM library_settings",
    );
    const settings = Object.fromEntries(
      settingsRes.rows.map((r) => [r.key, r.value]),
    );
    const maxLoans = parseInt(settings.max_active_loans || "3");
    const requireNim = settings.require_nim_approval !== "false";

    if (requireNim && (!req.user.nim || req.user.nim_status !== "approved")) {
      throw new HttpError(
        403,
        "Your NIM must be submitted and verified by Admin before borrowing",
      );
    }

    const activeRes = await client.query(
      `SELECT l.status, COUNT(li.id)::int AS count
       FROM loans l
       JOIN loan_items li ON l.id = li.loan_id
       WHERE l.user_id = $1
         AND l.status IN ('pending', 'approved', 'borrowed', 'return_request', 'overdue')
       GROUP BY l.status`,
      [req.user.id],
    );

    if (activeRes.rows.some((r) => r.status === "overdue")) {
      throw new HttpError(
        400,
        "Please return your overdue books before making a new loan request",
      );
    }

    const activeCount = activeRes.rows.reduce((sum, r) => sum + r.count, 0);
    if (activeCount + uniqueBookIds.length > maxLoans) {
      throw new HttpError(
        400,
        `Maximum active borrowed/requested books is ${maxLoans} (current: ${activeCount})`,
      );
    }

    const booksRes = await client.query(
      `SELECT id, title, available_stock, is_active FROM books WHERE id = ANY($1::int[]) FOR UPDATE`,
      [uniqueBookIds],
    );
    if (booksRes.rows.length !== uniqueBookIds.length) {
      throw new HttpError(404, "One or more books were not found");
    }

    for (const book of booksRes.rows) {
      if (!book.is_active || book.available_stock < 1) {
        throw new HttpError(
          400,
          `Book "${book.title}" is currently out of stock`,
        );
      }
    }

    const { rows: loanRows } = await client.query(
      `INSERT INTO loans (user_id, status, notes) VALUES ($1, 'pending', $2) RETURNING *`,
      [req.user.id, notes ?? null],
    );
    const created = loanRows[0];

    for (const bookId of uniqueBookIds) {
      await client.query(
        "INSERT INTO loan_items (loan_id, book_id) VALUES ($1, $2)",
        [created.id, bookId],
      );
    }

    await client.query(
      `INSERT INTO loan_status_histories (loan_id, from_status, to_status, changed_by, note)
       VALUES ($1, NULL, 'pending', $2, 'Loan requested by user')`,
      [created.id, req.user.id],
    );

    await client.query(
      `INSERT INTO activity_logs (user_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'CREATE_LOAN', 'loans', $2, $3)`,
      [req.user.id, created.id, JSON.stringify({ book_ids: uniqueBookIds })],
    );

    return created;
  });

  res.status(201).json({ message: "Loan request submitted", loan });
};

exports.getMyLoans = async (req, res) => {
  const { status } = req.valid.query;
  const params = [req.user.id];
  let filter = "";
  if (status) {
    params.push(status);
    filter = "AND l.status = $2";
  }

  const { rows } = await pool.query(
    `SELECT l.*, ls.label AS status_label,
            json_agg(json_build_object(
              'id', b.id,
              'title', b.title,
              'author', b.author,
              'cover_book', b.cover_book,
              'cover_image', b.cover_book,
              'copy_code', bc.copy_code
            )) AS books
     FROM loans l
     JOIN loan_statuses ls ON l.status = ls.code
     JOIN loan_items li ON l.id = li.loan_id
     JOIN books b ON li.book_id = b.id
     LEFT JOIN book_copies bc ON li.book_copy_id = bc.id
     WHERE l.user_id = $1 ${filter}
     GROUP BY l.id, ls.label
     ORDER BY l.created_at DESC`,
    params,
  );

  res.json({ loans: rows });
};

exports.getLoanDetail = async (req, res) => {
  const { id } = req.valid.params;
  const { rows } = await pool.query(
    `SELECT l.*, ls.label AS status_label, u.name AS user_name, u.email AS user_email, u.nim AS user_nim,
            json_agg(json_build_object(
              'id', b.id,
              'title', b.title,
              'author', b.author,
              'isbn', b.isbn,
              'cover_book', b.cover_book,
              'cover_image', b.cover_book,
              'copy_code', bc.copy_code
            )) AS books
     FROM loans l
     JOIN loan_statuses ls ON l.status = ls.code
     JOIN users u ON l.user_id = u.id
     JOIN loan_items li ON l.id = li.loan_id
     JOIN books b ON li.book_id = b.id
     LEFT JOIN book_copies bc ON li.book_copy_id = bc.id
     WHERE l.id = $1
     GROUP BY l.id, ls.label, u.name, u.email, u.nim`,
    [id],
  );

  if (!rows.length) throw new HttpError(404, "Loan transaction not found");
  if (req.user.role === "user" && rows[0].user_id !== req.user.id) {
    throw new HttpError(403, "Forbidden");
  }

  const histories = await pool.query(
    `SELECT h.*, u.name AS changed_by_name
     FROM loan_status_histories h
     LEFT JOIN users u ON h.changed_by = u.id
     WHERE h.loan_id = $1 ORDER BY h.created_at ASC`,
    [id],
  );

  res.json({ loan: { ...rows[0], histories: histories.rows } });
};

exports.cancelLoan = async (req, res) => {
  const { id } = req.valid.params;

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      "SELECT * FROM loans WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [id, req.user.id],
    );
    if (!rows.length) throw new HttpError(404, "Loan transaction not found");
    if (rows[0].status !== "pending") {
      throw new HttpError(400, "Only pending loan requests can be cancelled");
    }

    await client.query(`UPDATE loans SET status = 'cancelled' WHERE id = $1`, [
      id,
    ]);
    await client.query(
      `INSERT INTO loan_status_histories (loan_id, from_status, to_status, changed_by, note)
       VALUES ($1, 'pending', 'cancelled', $2, 'Cancelled by user')`,
      [id, req.user.id],
    );
  });

  res.json({ message: "Loan request cancelled" });
};

exports.requestReturn = async (req, res) => {
  const { id } = req.valid.params;

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      "SELECT * FROM loans WHERE id = $1 AND user_id = $2 FOR UPDATE",
      [id, req.user.id],
    );
    if (!rows.length) throw new HttpError(404, "Loan transaction not found");
    if (!["borrowed", "overdue"].includes(rows[0].status)) {
      throw new HttpError(
        400,
        "Only borrowed books can be requested for return",
      );
    }

    await client.query(
      `UPDATE loans SET status = 'return_request' WHERE id = $1`,
      [id],
    );
    await client.query(
      `INSERT INTO loan_status_histories (loan_id, from_status, to_status, changed_by, note)
       VALUES ($1, $2, 'return_request', $3, 'Return requested by user')`,
      [id, rows[0].status, req.user.id],
    );
  });

  res.json({ message: "Return request submitted" });
};

exports.getAllLoansAdmin = async (req, res) => {
  await pool.query(
    `UPDATE loans SET status = 'overdue' WHERE status = 'borrowed' AND due_date < CURRENT_DATE`,
  );

  const { status, search } = req.valid.query;
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`l.status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(
      `(LOWER(u.name) LIKE $${params.length}
        OR LOWER(u.nim) LIKE $${params.length}
        OR LOWER(bc.copy_code) LIKE $${params.length})`,
    );
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";
  const { rows } = await pool.query(
    `SELECT l.*, ls.label AS status_label, u.name AS user_name, u.email AS user_email, u.nim AS user_nim,
            json_agg(json_build_object(
              'id', b.id,
              'title', b.title,
              'author', b.author,
              'cover_book', b.cover_book,
              'cover_image', b.cover_book,
              'copy_code', bc.copy_code
            )) AS books
     FROM loans l
     JOIN loan_statuses ls ON l.status = ls.code
     JOIN users u ON l.user_id = u.id
     JOIN loan_items li ON l.id = li.loan_id
     JOIN books b ON li.book_id = b.id
     LEFT JOIN book_copies bc ON li.book_copy_id = bc.id
     ${whereClause}
     GROUP BY l.id, ls.label, u.name, u.email, u.nim
     ORDER BY l.created_at DESC`,
    params,
  );

  res.json({ loans: rows });
};

exports.approveLoan = async (req, res) => {
  const { id } = req.valid.params;
  const {
    duration_days,
    due_date,
    require_pickup,
    copy_codes = [],
    note,
  } = req.valid.body;

  const updatedLoan = await withTransaction(async (client) => {
    const { rows } = await client.query(
      "SELECT * FROM loans WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!rows.length) throw new HttpError(404, "Loan transaction not found");
    const loan = rows[0];
    if (loan.status !== "pending") {
      throw new HttpError(400, "Only pending loans can be approved");
    }

    const settingRes = await client.query(
      `SELECT value FROM library_settings WHERE key = 'loan_duration_days'`,
    );
    const days = duration_days || parseInt(settingRes.rows[0]?.value || "7");

    const itemsRes = await client.query(
      `SELECT li.id AS loan_item_id, b.id AS book_id, b.title, b.available_stock
       FROM loan_items li
       JOIN books b ON li.book_id = b.id
       WHERE li.loan_id = $1 FOR UPDATE OF b`,
      [loan.id],
    );

    for (let i = 0; i < itemsRes.rows.length; i++) {
      const item = itemsRes.rows[i];
      if (item.available_stock < 1) {
        throw new HttpError(
          400,
          `Cannot approve: "${item.title}" is out of stock`,
        );
      }

      const requestedCode = copy_codes[i];
      const copyQuery = requestedCode
        ? await client.query(
            `SELECT id, copy_code FROM book_copies
             WHERE book_id = $1 AND LOWER(copy_code) = LOWER($2) AND status = 'available'
             FOR UPDATE`,
            [item.book_id, requestedCode],
          )
        : await client.query(
            `SELECT id, copy_code FROM book_copies
             WHERE book_id = $1 AND status = 'available'
             ORDER BY id ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
            [item.book_id],
          );

      if (!copyQuery.rows.length) {
        throw new HttpError(
          400,
          requestedCode
            ? `Kode buku "${requestedCode}" tidak tersedia untuk "${item.title}"`
            : `Tidak ada eksemplar berkode yang tersedia untuk "${item.title}"`,
        );
      }

      const chosenCopy = copyQuery.rows[0];
      await client.query(
        `UPDATE book_copies SET status = 'borrowed' WHERE id = $1`,
        [chosenCopy.id],
      );
      await client.query(
        `UPDATE loan_items SET book_copy_id = $1 WHERE id = $2`,
        [chosenCopy.id, item.loan_item_id],
      );
      await client.query(
        `UPDATE books SET available_stock = available_stock - 1 WHERE id = $1`,
        [item.book_id],
      );
    }

    const nextStatus = require_pickup ? "approved" : "borrowed";
    const dueExpr = due_date
      ? "$3::date"
      : `CURRENT_DATE + ($3 || ' days')::INTERVAL`;
    const dueParam = due_date ? due_date : days;

    const { rows: updated } = await client.query(
      `UPDATE loans SET
        status = $1,
        approved_by = $2,
        approved_at = NOW(),
        loan_date = CURRENT_DATE,
        due_date = ${dueExpr}
       WHERE id = $4 RETURNING *`,
      [nextStatus, req.user.id, dueParam, loan.id],
    );

    const formattedDueDate =
      updated[0].due_date instanceof Date
        ? updated[0].due_date.toISOString().split("T")[0]
        : String(updated[0].due_date).slice(0, 10);

    await client.query(
      `INSERT INTO loan_status_histories (loan_id, from_status, to_status, changed_by, note)
       VALUES ($1, 'pending', $2, $3, $4)`,
      [loan.id, nextStatus, req.user.id, note || "Approved by Admin"],
    );

    await client.query(
      `INSERT INTO notifications (user_id, loan_id, title, message) VALUES ($1, $2, 'Peminjaman Disetujui', $3)`,
      [
        loan.user_id,
        loan.id,
        `Pengajuan peminjaman #${loan.id} telah disetujui. Batas pengembalian: ${formattedDueDate}.`,
      ],
    );

    return updated[0];
  });

  res.json({ message: "Loan approved", loan: updatedLoan });
};

exports.handoverLoan = async (req, res) => {
  const { id } = req.valid.params;

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      "SELECT * FROM loans WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!rows.length || rows[0].status !== "approved") {
      throw new HttpError(400, "Only approved loans can be marked as borrowed");
    }
    await client.query(
      `UPDATE loans SET status = 'borrowed', loan_date = CURRENT_DATE WHERE id = $1`,
      [id],
    );
    await client.query(
      `INSERT INTO loan_status_histories (loan_id, from_status, to_status, changed_by, note)
       VALUES ($1, 'approved', 'borrowed', $2, 'Books handed over to borrower')`,
      [id, req.user.id],
    );
  });

  res.json({ message: "Loan status updated to borrowed" });
};

exports.rejectLoan = async (req, res) => {
  const { id } = req.valid.params;
  const { note } = req.valid.body;

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      "SELECT * FROM loans WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!rows.length || rows[0].status !== "pending") {
      throw new HttpError(400, "Only pending loans can be rejected");
    }

    const reason = note || "Rejected by Admin";
    await client.query(
      `UPDATE loans SET status = 'rejected', notes = $1 WHERE id = $2`,
      [reason, id],
    );
    await client.query(
      `INSERT INTO loan_status_histories (loan_id, from_status, to_status, changed_by, note)
       VALUES ($1, 'pending', 'rejected', $2, $3)`,
      [id, req.user.id, reason],
    );
    await client.query(
      `INSERT INTO notifications (user_id, loan_id, title, message) VALUES ($1, $2, 'Peminjaman Ditolak', $3)`,
      [
        rows[0].user_id,
        id,
        `Pengajuan peminjaman #${id} ditolak. Alasan: ${reason}`,
      ],
    );
  });

  res.json({ message: "Loan request rejected" });
};

exports.confirmReturn = async (req, res) => {
  const { id } = req.valid.params;

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      "SELECT * FROM loans WHERE id = $1 FOR UPDATE",
      [id],
    );
    if (!rows.length) throw new HttpError(404, "Loan transaction not found");

    const loan = rows[0];
    if (!["borrowed", "return_request", "overdue"].includes(loan.status)) {
      throw new HttpError(400, "Invalid loan status for return confirmation");
    }

    await client.query(
      `UPDATE loans
       SET status = 'returned', returned_at = NOW(), received_by = $1
       WHERE id = $2`,
      [req.user.id, loan.id],
    );

    await client.query(
      `UPDATE book_copies bc
       SET status = 'available'
       FROM loan_items li
       WHERE li.book_copy_id = bc.id AND li.loan_id = $1`,
      [loan.id],
    );

    await client.query(
      `UPDATE books b
       SET available_stock = (
         SELECT COUNT(*)::int FROM book_copies WHERE book_id = b.id AND status = 'available'
       )
       FROM loan_items li
       WHERE li.book_id = b.id AND li.loan_id = $1`,
      [loan.id],
    );

    await client.query(
      `INSERT INTO loan_status_histories (loan_id, from_status, to_status, changed_by, note)
       VALUES ($1, $2, 'returned', $3, 'Book return confirmed by Admin')`,
      [loan.id, loan.status, req.user.id],
    );

    await client.query(
      `INSERT INTO notifications (user_id, loan_id, title, message) VALUES ($1, $2, 'Pengembalian Selesai', $3)`,
      [
        loan.user_id,
        loan.id,
        `Pengembalian buku transaksi #${loan.id} telah dikonfirmasi.`,
      ],
    );
  });

  res.json({ message: "Book return confirmed and stock restored" });
};
