const pool = require("../db/connect");

exports.getUserDashboard = async (req, res) => {
  const userId = req.user.id;
  const [summaryRes, activeLoansRes, latestBooksRes] = await Promise.all([
    pool.query(
      `SELECT
        COUNT(li.id) FILTER (WHERE l.status IN ('borrowed', 'overdue', 'return_requested'))::int AS borrowed_books_count,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'pending')::int AS pending_requests_count,
        COUNT(DISTINCT l.id) FILTER (WHERE l.status = 'returned')::int AS completed_loans_count
       FROM loans l
       LEFT JOIN loan_items li ON l.id = li.loan_id
       WHERE l.user_id = $1`,
      [userId],
    ),
    pool.query(
      `SELECT l.id, l.status, ls.label AS status_label, l.loan_date, l.due_date, l.created_at,
              json_agg(json_build_object('id', b.id, 'title', b.title, 'author', b.author, 'cover_book', b.cover_book)) AS books
       FROM loans l
       JOIN loan_statuses ls ON l.status = ls.code
       JOIN loan_items li ON l.id = li.loan_id
       JOIN books b ON li.book_id = b.id
       WHERE l.user_id = $1 AND l.status IN ('pending', 'approved', 'borrowed', 'return_requested', 'overdue')
       GROUP BY l.id, ls.label ORDER BY l.created_at DESC`,
      [userId],
    ),
    pool.query(
      `SELECT b.*, c.name AS category_name, (b.available_stock > 0) AS is_available
       FROM books b LEFT JOIN categories c ON b.category_id = c.id
       WHERE b.is_active = TRUE ORDER BY b.created_at DESC LIMIT 6`,
    ),
  ]);

  res.json({
    summary: summaryRes.rows[0],
    activeLoans: activeLoansRes.rows,
    latestBooks: latestBooksRes.rows,
  });
};

exports.getAdminDashboard = async (req, res) => {
  await pool.query(
    `UPDATE loans SET status = 'overdue' WHERE status = 'borrowed' AND due_date < CURRENT_DATE`,
  );

  const [booksRes, usersRes, loansRes, recentRes] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total_books,
              COALESCE(SUM(total_stock), 0)::int AS total_stock,
              COALESCE(SUM(available_stock), 0)::int AS available_stock
       FROM books WHERE is_active = TRUE`,
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total_users,
              COUNT(*) FILTER (WHERE nim_status = 'pending')::int AS pending_nim_count
       FROM users WHERE role = 'user'`,
    ),
    pool.query(
      `SELECT
        COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_loans,
        COUNT(*) FILTER (WHERE status IN ('approved', 'borrowed', 'overdue'))::int AS active_loans,
        COUNT(*) FILTER (WHERE status = 'return_requested')::int AS return_requested,
        COUNT(*) FILTER (WHERE status = 'returned')::int AS total_returns
       FROM loans`,
    ),
    pool.query(
      `SELECT l.id, l.status, ls.label AS status_label, l.loan_date, l.due_date, l.created_at,
              u.name AS user_name, u.nim,
              json_agg(json_build_object('id', b.id, 'title', b.title)) AS books
       FROM loans l
       JOIN loan_statuses ls ON l.status = ls.code
       JOIN users u ON l.user_id = u.id
       JOIN loan_items li ON l.id = li.loan_id
       JOIN books b ON li.book_id = b.id
       GROUP BY l.id, ls.label, u.name, u.nim
       ORDER BY l.created_at DESC LIMIT 10`,
    ),
  ]);

  res.json({
    books: booksRes.rows[0],
    users: usersRes.rows[0],
    loans: loansRes.rows[0],
    recentTransactions: recentRes.rows,
  });
};

exports.getSettings = async (req, res) => {
  const { rows } = await pool.query(
    "SELECT key, value, description, updated_at FROM library_settings ORDER BY key ASC",
  );
  res.json({ settings: rows });
};

exports.updateSettings = async (req, res) => {
  const entries = Object.entries(req.valid.body);
  for (const [key, value] of entries) {
    await pool.query(
      `UPDATE library_settings SET value = $1, updated_by = $2 WHERE key = $3`,
      [String(value), req.user.id, key],
    );
  }
  const { rows } = await pool.query(
    "SELECT key, value, description, updated_at FROM library_settings ORDER BY key ASC",
  );
  res.json({ message: "Settings updated", settings: rows });
};
