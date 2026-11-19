const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db/connect");
const HttpError = require("../utils/httpError");

const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "1d",
  });

exports.register = async (req, res) => {
  const { name, email, password, nim } = req.valid.body;
  const passwordHash = await bcrypt.hash(password, 10);
  const cleanNim = nim && nim.trim() !== "" ? nim.trim() : null;

  try {
    const { rows } = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, nim, nim_status)
       VALUES ($1, $2, $3, 'user', $4, $5)
       RETURNING id, name, email, role, is_active, nim, nim_status, created_at`,
      [name, email, passwordHash, cleanNim, cleanNim ? "pending" : "none"],
    );

    const user = rows[0];
    res.status(201).json({
      message: "Registration successful",
      user,
      token: signToken(user),
    });
  } catch (errors) {
    if (errors.code === "23505") {
      throw new HttpError(409, "Email or NIM is already registered");
    }
    throw errors;
  }
};

exports.login = async (req, res) => {
  const { email, password } = req.valid.body;

  const { rows } = await pool.query(
    "SELECT * FROM users WHERE LOWER(email) = $1",
    [email],
  );
  const user = rows[0];

  const valid = user && (await bcrypt.compare(password, user.password_hash));
  if (!valid) throw new HttpError(401, "Invalid email or password");
  if (!user.is_active) throw new HttpError(403, "Account is deactivated");

  await pool.query(
    `INSERT INTO activity_logs (user_id, action, entity_type, entity_id)
     VALUES ($1, 'USER_LOGIN', 'users', $1)`,
    [user.id],
  );

  const { password_hash, ...safeUser } = user;
  res.json({ user: safeUser, token: signToken(user) });
};

exports.me = async (req, res) => {
  res.json({ user: req.user });
};

exports.logout = async (req, res) => {
  await pool.query(
    `INSERT INTO activity_logs (user_id, action, entity_type, entity_id)
     VALUES ($1, 'USER_LOGOUT', 'users', $1)`,
    [req.user.id],
  );
  res.json({ message: "Logged out" });
};
