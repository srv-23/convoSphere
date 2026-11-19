import jwt from "jsonwebtoken";
import { ENV, isProduction } from "./env.js";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Cookie options shared by set and clear. Clearing a cookie with different
 * options than it was set with leaves the original cookie in place, so both
 * paths must use the same object.
 */
export function authCookieOptions() {
  return {
    httpOnly: true, // not readable from JS, so XSS cannot steal the session
    sameSite: "strict", // blocks cross-site request forgery
    // Must depend on production, not on "=== development": when NODE_ENV is
    // unset, the old logic marked the cookie Secure and the browser silently
    // dropped it over http://localhost.
    secure: isProduction,
    path: "/",
  };
}

export const generateToken = (userId, res) => {
  const { JWT_SECRET } = ENV;
  if (!JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }

  const token = jwt.sign({ userId }, JWT_SECRET, {
    expiresIn: "7d",
    algorithm: "HS256",
  });

  res.cookie("jwt", token, { ...authCookieOptions(), maxAge: TOKEN_TTL_MS });

  return token;
};

export const clearToken = (res) => {
  res.clearCookie("jwt", authCookieOptions());
};

/**
 * Normalise an email so "A@B.com " and "a@b.com" are the same account.
 * Without this, the unique index is case-sensitive and duplicates slip in.
 */
export const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export const normalizeText = (value) => (typeof value === "string" ? value.trim() : "");

/** Clamp a requested page size into a safe range. */
export const clampLimit = (value, fallback, max = 100) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
};
