const express = require("express");
require("dotenv").config();
const cors = require("cors");
const pool = require("./db/connect");
const errorHandler = require("./middleware/errorHandler");

const authRoutes = require("./routes/auth.routes");
const bookRoutes = require("./routes/book.routes");
const userRoutes = require("./routes/user.routes");
const loanRoutes = require("./routes/loan.routes");
const adminRoutes = require("./routes/admin.routes");

const app = express();

app.use(cors());
app.use(express.json());

const port = process.env.PORT;

app.get("/health", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT NOW()");
    res.json({ ok: true, time: rows[0].now });
  } catch (errors) {
    res.status(500).json({ ok: false, error: errors.message });
  }
});

const allowedOrigin = process.env.FRONTEND_URL.split(",").map((origin) =>
  origin.trim(),
);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigin.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin ${origin} tidak diizinkan cors`));
    },
    credentials: true,
  }),
);

app.use(express.json());

app.use(express.urlencoded({ extended: true }));

if (require.main === module) {
  const PORT = process.env.PORT;
  app.listen(PORT, () => {
    console.log(`Server running at ${PORT}`);
  });
}

app.use("/api/auth", authRoutes);
app.use("/api", bookRoutes);
app.use("/api/users", userRoutes);
app.use("/api/loans", loanRoutes);
app.use("/api/admin", adminRoutes);

app.use((req, res) => res.status(404).json({ message: "Not Found" }));
app.use(errorHandler);

app.listen(port, () => {
  console.log(`server running at port: ${port}`);
});

module.exports = app;
