const multer = require("multer");
const HttpError = require("../utils/httpError");

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedMimes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

  if (allowedMimes.includes(file.mimetype.toLowerCase())) {
    cb(null, true);
  } else {
    cb(
      new HttpError(
        400,
        `Format gambar tidak didukung (${file.mimetype}). Gunakan JPEG, PNG, atau WEBP`,
      ),
      false,
    );
  }
};

const uploadBookCover = multer({
  storage,
  fileFilter,
  limits: { fileSize: 4 * 1024 * 1024 },
});

module.exports = { uploadBookCover };
