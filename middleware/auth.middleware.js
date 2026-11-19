const jwt = require("jsonwebtoken");
const pool = require("../db/connect");
const HttpError = require("../utils/httpError");

function getToken(req) {
  const [type, token] = (req.headers.authorization || "").split("");
  return type === "Bearer" ? token : null;
}

async function loadUser(token) {
  const payload = jwt.verify(token, process.env.JWT_SECRET);
  const { rows } = await pool.query(
    `SELECT id, name, email, role, is_active, nim, nim_status, FROM users WHERE id = $1`,
    [payload.id],
  );

  const user = rows[0];
  if (!user || !user.is_active) throw new Error("inactive");
  return user;
}

async function authenticate(req, res, next) {
  const token = getToken(req);
  if (!token) return next(new HttpError(401, "Authentication required"));
  try {
    req.user = await loadUser(token);
    next();
  } catch {
    next(new HttpError(401, "Invalid or expired token"));
  }
}

// untuk endpoint publik yang isinya beda kalau yang akses staff
async function optionalAuth(req, res, next) {
  const token = getToken(req);
  if (token) {
    try {
      req.user = await loadUser(token);
    } catch {
      // token tidak valid dianggap guest
    }
  }
  next();
}

const authorize =
  (...roles) =>
  (req, res, next) =>
    roles.includes(req.user?.role)
      ? next()
      : next(new HttpError(403, "Forbidden"));

module.exports = { authenticate, optionalAuth, authorize };
