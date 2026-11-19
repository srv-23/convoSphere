import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import authRoutes from "../routes/auth.route.js";
import messageRoutes from "../routes/message.route.js";
import { ENV, isProduction } from "./env.js";
import { errorHandler, notFound } from "../middleware/error.middleware.js";

/**
 * Builds the Express app without binding a port, so tests can drive it with
 * supertest and server.js stays a thin bootstrap.
 */
export function createApp() {
  const app = express();

  app.disable("x-powered-by");

  // Behind a platform proxy (Render/Railway/Fly), req.ip is the proxy's IP
  // unless Express is told to trust exactly one hop. Without this, rate
  // limiting sees every user as the same address.
  if (ENV.TRUST_PROXY > 0) {
    app.set("trust proxy", ENV.TRUST_PROXY);
  }

  app.use(
    helmet({
      // Disabled: the SPA is served from this origin and loads assets from
      // Cloudinary; a default CSP would need allow-listing and is a
      // deployment-specific decision.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    })
  );

  // 5 MB of decoded image becomes ~6.7 MB of base64, so the body limit must
  // leave headroom above MAX_IMAGE_BYTES.
  app.use(express.json({ limit: "8mb" }));
  app.use(cors({ origin: ENV.CLIENT_URL, credentials: true }));
  app.use(cookieParser());

  app.get("/api/health", (_req, res) => {
    res.status(200).json({ status: "ok", uptime: process.uptime() });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/messages", messageRoutes);

  // In production the frontend is built into frontend/dist and served here.
  // Resolve from this file, not from process.cwd(), so it works no matter
  // which directory the process was started from.
  if (isProduction) {
    const distDir = path.resolve(
      // src/lib -> backend -> repo root -> frontend/dist
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../frontend/dist"
    );
    const indexHtml = path.join(distDir, "index.html");

    if (fs.existsSync(indexHtml)) {
      app.use(express.static(distDir));

      // Client-side routes (/chat, /login) must return index.html. An unknown
      // /api path must NOT: it falls through to the JSON 404 handler below,
      // otherwise a typo'd endpoint answers with HTML and status 200.
      app.get("*", (req, res, next) => {
        if (req.path.startsWith("/api")) return next();
        return res.sendFile(indexHtml);
      });
    } else {
      console.warn("Production build not found at", distDir);
    }
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
