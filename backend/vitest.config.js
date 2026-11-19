import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.js"],
    testTimeout: 30000,
    hookTimeout: 60000,
    // Tests must never reach a hosted service or a real database. Empty
    // strings keep optional integrations (Resend, Cloudinary, Arcjet) in
    // their disabled fallback mode; each suite starts its own in-memory
    // MongoDB.
    env: {
      NODE_ENV: "test",
      JWT_SECRET: "test-jwt-secret-long-enough",
      MONGO_URI: "mongodb://127.0.0.1:27017/convosphere-test-placeholder",
      CLIENT_URL: "http://localhost:5173",
      RESEND_API_KEY: "",
      CLOUDINARY_CLOUD_NAME: "",
      CLOUDINARY_API_KEY: "",
      CLOUDINARY_API_SECRET: "",
      ARCJET_KEY: "",
    },
  },
});
