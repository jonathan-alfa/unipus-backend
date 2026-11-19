const bcrypt = require("bcrypt");
const pool = require("../db/connect");
const HttpError = require("../utils/httpError");

exports.getProfile = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, email, role, is_active, nim, nim_status, nim_review_note, nim_reviewed_at, created_at, updated_at
     FROM users WHERE id = $1`,
    [req.user.id],
  );
  res.json({ user: rows[0] });
};

exports.updateProfile = async (req, res) => {
  const { name, current_password, new_password } = req.valid.body;
  const updates = [];
  const params = [];

  if (name) {
    params.push(name);
    updates.push(`name = $${params.length}`);
  }

  if (new_password) {
    if (!current_password) {
      throw new HttpError(
        400,
        "Current password is required to set a new password",
      );
    }
    const { rows: uRows } = await pool.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [req.user.id],
    );
    const match = await bcrypt.compare(
      current_password,
      uRows[0].password_hash,
    );
    if (!match) throw new HttpError(400, "Current password is incorrect");

    const hash = await bcrypt.hash(new_password, 10);
    params.push(hash);
    updates.push(`password_hash = $${params.length}`);
  }

  if (!updates.length) throw new HttpError(400, "No fields provided to update");

  params.push(req.user.id);
  const { rows } = await pool.query(
    `UPDATE users SET ${updates.join(", ")} WHERE id = $${params.length}
     RETURNING id, name, email, role, is_active, nim, nim_status, updated_at`,
    params,
  );

  res.json({ message: "Profile updated", user: rows[0] });
};

exports.submitNim = async (req, res) => {
  const { nim } = req.valid.body;
  if (req.user.nim_status === "approved" && req.user.nim === nim) {
    throw new HttpError(400, "NIM is already verified");
  }

  const { rows } = await pool.query(
    `UPDATE users
     SET nim = $1, nim_status = 'pending', nim_review_note = NULL, nim_reviewed_by = NULL, nim_reviewed_at = NULL
     WHERE id = $2
     RETURNING id, name, email, nim, nim_status`,
    [nim, req.user.id],
  );

  res.json({ message: "NIM submitted for verification", user: rows[0] });
};

exports.getNotifications = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [req.user.id],
  );
  res.json({ notifications: rows });
};

exports.markNotificationRead = async (req, res) => {
  const { id } = req.valid.params;
  const { rowCount } = await pool.query(
    `UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2`,
    [id, req.user.id],
  );
  if (!rowCount) throw new HttpError(404, "Notification not found");
  res.json({ message: "Notification marked as read" });
};

exports.markAllNotificationsRead = async (req, res) => {
  await pool.query(
    `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
    [req.user.id],
  );
  res.json({ message: "All notifications marked as read" });
};

// --- ADMIN ---
exports.getUsersAdmin = async (req, res) => {
  const { nim_status, search } = req.valid.query;
  const conditions = [`role = 'user'`];
  const params = [];

  if (nim_status) {
    params.push(nim_status);
    conditions.push(`nim_status = $${params.length}`);
  }
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    conditions.push(
      `(LOWER(name) LIKE $${params.length} OR LOWER(email) LIKE $${params.length} OR LOWER(nim) LIKE $${params.length})`,
    );
  }

  const { rows } = await pool.query(
    `SELECT id, name, email, role, is_active, nim, nim_status, nim_review_note, nim_reviewed_at, created_at
     FROM users WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`,
    params,
  );
  res.json({ users: rows });
};

exports.reviewUserNim = async (req, res) => {
  const { id } = req.valid.params;
  const { status, note } = req.valid.body;

  const { rows } = await pool.query(
    `UPDATE users
     SET nim_status = $1, nim_review_note = $2, nim_reviewed_by = $3, nim_reviewed_at = NOW()
     WHERE id = $4 AND role = 'user'
     RETURNING id, name, email, nim, nim_status, nim_review_note, nim_reviewed_at`,
    [status, note ?? null, req.user.id, id],
  );
  if (!rows.length) throw new HttpError(404, "User not found");

  await pool.query(
    `INSERT INTO notifications (user_id, title, message) VALUES ($1, $2, $3)`,
    [
      rows[0].id,
      status === "approved"
        ? "Verifikasi NIM Disetujui"
        : "Verifikasi NIM Ditolak",
      status === "approved"
        ? `NIM (${rows[0].nim}) telah disetujui Admin. Anda dapat mengajukan peminjaman buku.`
        : `Pengajuan NIM ditolak. Catatan: ${note || "Silakan periksa kembali NIM Anda."}`,
    ],
  );

  res.json({ message: `NIM ${status}`, user: rows[0] });
};

exports.toggleUserStatus = async (req, res) => {
  const { id } = req.valid.params;
  const { is_active } = req.valid.body;

  const { rows } = await pool.query(
    `UPDATE users SET is_active = $1 WHERE id = $2 AND role = 'user'
     RETURNING id, name, email, is_active`,
    [is_active, id],
  );
  if (!rows.length) throw new HttpError(404, "User not found");
  res.json({ message: "User status updated", user: rows[0] });
};
