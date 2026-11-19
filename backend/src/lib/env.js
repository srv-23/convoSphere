import "dotenv/config";
import { z } from "zod";

// Validate configuration once, at boot, so a missing or malformed variable
// fails loudly here instead of surfacing as a confusing 500 on the first
// request that needs it.

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),

  MONGO_URI: z.string().min(1, "MONGO_URI is required"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters"),

  CLIENT_URL: z.string().min(1).default("http://localhost:5173"),

  // Optional: external services are validated on use, so the app can boot
  // (and run the test suite) without production credentials.
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_FROM_NAME: z.string().optional(),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  ARCJET_KEY: z.string().optional(),
  ARCJET_ENV: z.string().optional(),

  // Networking
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  DNS_SERVERS: z.string().optional(),

  // Limits
  MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),
  MESSAGE_PAGE_SIZE: z.coerce.number().int().min(1).max(100).default(30),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  process.exit(1);
}

export const ENV = parsed.data;

export const isProduction = ENV.NODE_ENV === "production";
export const isTest = ENV.NODE_ENV === "test";
