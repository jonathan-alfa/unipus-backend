const { z } = require("zod");
const HttpError = require("../utils/httpError");

module.exports =
  ({ body, query, params }) =>
  (req, res, next) => {
    try {
      req.valid = {};
      if (body) req.valid.body = body.parse(req.body);
      if (query) req.valid.query = query.parse(req.query);
      if (params) req.valid.params = params.parse(req.params);
      next();
    } catch (errors) {
      if (errors instanceof z.ZodError) {
        const details = errors.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        }));
        return next(new HttpError(400, "Validation failed", details));
      }
      next(errors);
    }
  };
