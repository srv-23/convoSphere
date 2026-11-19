import { isProduction } from "../lib/env.js";

/**
 * Unknown /api routes should return JSON, not Express' default HTML page
 * (or, in production, the SPA's index.html).
 */
export const notFound = (req, res) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
};

/**
 * Central error handler. Turns known error shapes into honest status codes:
 * a bad id or an expired token is a client error, not a server crash.
 */
export const errorHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);

  // Mongoose: malformed ObjectId passed in a param
  if (err?.name === "CastError") {
    return res.status(400).json({ message: "Invalid identifier" });
  }

  // Mongoose: schema validation failure
  if (err?.name === "ValidationError") {
    const first = Object.values(err.errors ?? {})[0];
    return res.status(400).json({ message: first?.message ?? "Invalid request data" });
  }

  // body-parser: payload over the JSON limit
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ message: "Payload too large. Compress the image and try again." });
  }

  // body-parser: malformed JSON
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Malformed JSON body" });
  }

  // jsonwebtoken
  if (err?.name === "TokenExpiredError") {
    return res.status(401).json({ message: "Session expired. Please log in again." });
  }
  if (err?.name === "JsonWebTokenError" || err?.name === "NotBeforeError") {
    return res.status(401).json({ message: "Invalid authentication token" });
  }

  const status = Number.isInteger(err?.status) ? err.status : 500;

  if (status >= 500) {
    console.error("Unhandled request error:", err);
  }

  res.status(status).json({
    message: status >= 500 && isProduction ? "Internal server error" : (err?.message ?? "Internal server error"),
  });
};
