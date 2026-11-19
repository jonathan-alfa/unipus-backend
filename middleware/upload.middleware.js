const multer = require("multer");
const HttpError = require("../utils/httpError");

const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
  if (allowedTypes.includes(file.mimetypes)) {
    cb(null, true);
  } else {
    cb(new HttpError(400, "Image format must be JPEG, PNG, or JPG"), false);
  }
};

const uploadBookCover = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
});

module.exports = { uploadBookCover };
