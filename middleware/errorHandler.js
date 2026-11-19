module.exports = (err, req, res, next) => {
  let status = err.status || 500;
  let message = err.message;

  if (err.code === "23505") {
    status = 409;
    message = "Data already exist";
  } else if (err.code === "23503") {
    status = 409;
    message = "Operation conflicts with related data";
  } else if (err.code === "23514") {
    status = 400;
    message = "Data violates a constraint";
  } else if (err.type === "entity.parse.failed") {
    status = 400;
    message = "Invalid JSON body";
  }

  if (status >= 500) {
    console.error(err);
    message = "Internal server error";
  }

  res
    .status(status)
    .json({ message, ...(err.details && { errors: err.details }) });
};
