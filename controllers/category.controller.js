const pool = require("../db/connect");
const HttpError = require("../utils/httpError");

exports.getCategories = async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.*, COUNT(b.id) FILTER (WHERE b.is_active = TRUE)::int AS total_books
     FROM categories c
     LEFT JOIN books b ON b.category_id = c.id
     GROUP BY c.id ORDER BY c.name ASC`,
  );
  res.json({ categories: rows });
};

exports.createCategory = async (req, res) => {
  const { name, description } = req.valid.body;
  const { rows } = await pool.query(
    `INSERT INTO categories (name, description) VALUES ($1, $2) RETURNING *`,
    [name, description ?? null],
  );
  res.status(201).json({ message: "Category created", category: rows[0] });
};

exports.updateCategory = async (req, res) => {
  const { id } = req.valid.params;
  const { name, description } = req.valid.body;

  const { rows } = await pool.query(
    `UPDATE categories
     SET name = COALESCE($1, name), description = COALESCE($2, description)
     WHERE id = $3 RETURNING *`,
    [name ?? null, description ?? null, id],
  );
  if (!rows.length) throw new HttpError(404, "Category not found");
  res.json({ message: "Category updated", category: rows[0] });
};

exports.deleteCategory = async (req, res) => {
  const { id } = req.valid.params;
  const { rowCount } = await pool.query(
    "DELETE FROM categories WHERE id = $1",
    [id],
  );
  if (!rowCount) throw new HttpError(404, "Category not found");
  res.json({ message: "Category deleted" });
};
