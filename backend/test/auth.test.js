import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

// Cloudinary is a paid external service; stub it so the upload path can be
// tested without credentials or network.
vi.mock("../src/lib/cloudinary.js", () => ({
  default: {
    uploader: {
      upload: vi.fn(async () => ({
        secure_url: "https://res.cloudinary.com/demo/image/upload/avatar.jpg",
        public_id: "convosphere/avatars/avatar",
      })),
      destroy: vi.fn(async () => ({ result: "ok" })),
    },
  },
}));

import { app, io } from "../src/lib/socket.js";
import { ENV } from "../src/lib/env.js";
import User from "../src/models/User.js";
import { clearDatabase, startDatabase, stopDatabase } from "./helpers.js";

const PNG_1PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

beforeAll(async () => {
  await startDatabase();
});

afterAll(async () => {
  await stopDatabase();
  await io.close();
});

beforeEach(async () => {
  await clearDatabase();
});

const signup = (agent, overrides = {}) =>
  agent.post("/api/auth/signup").send({
    fullName: "Ada Lovelace",
    email: "ada@example.com",
    password: "password123",
    ...overrides,
  });

const jwtCookie = (res) =>
  (res.headers["set-cookie"] ?? []).find((cookie) => cookie.startsWith("jwt="));

describe("POST /api/auth/signup", () => {
  it("rejects missing fields", async () => {
    const res = await request(app).post("/api/auth/signup").send({ email: "a@b.com" });
    expect(res.status).toBe(400);
  });

  it("rejects a short password", async () => {
    const res = await signup(request.agent(app), { password: "123" });
    expect(res.status).toBe(400);
  });

  it("rejects a malformed email", async () => {
    const res = await signup(request.agent(app), { email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("creates the user, hashes the password and sets an httpOnly cookie", async () => {
    const res = await signup(request.agent(app));

    expect(res.status).toBe(201);
    expect(res.body.email).toBe("ada@example.com");
    expect(res.body.password).toBeUndefined();

    const stored = await User.findOne({ email: "ada@example.com" }).select("+password");
    expect(stored.password).not.toBe("password123");
    expect(await bcrypt.compare("password123", stored.password)).toBe(true);

    const cookie = jwtCookie(res);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).not.toContain("Secure"); // not production
  });

  it("normalises email case and rejects a duplicate", async () => {
    await signup(request.agent(app), { email: "Ada@Example.com" });

    const duplicate = await signup(request.agent(app), { email: "ada@example.com" });
    expect(duplicate.status).toBe(409);

    // Both spellings must resolve to one account.
    const count = await User.countDocuments({});
    expect(count).toBe(1);
  });
});

describe("POST /api/auth/login", () => {
  beforeEach(async () => {
    await signup(request.agent(app));
  });

  it("logs in with valid credentials (password is select:false on the schema)", async () => {
    const agent = request.agent(app);
    const res = await agent
      .post("/api/auth/login")
      .send({ email: "ADA@example.com", password: "password123" });

    expect(res.status).toBe(200);
    expect(res.body.password).toBeUndefined();
    expect(jwtCookie(res)).toBeDefined();
  });

  it("returns the same error for a wrong password and an unknown email", async () => {
    const wrongPassword = await request(app)
      .post("/api/auth/login")
      .send({ email: "ada@example.com", password: "nope" });

    const unknownEmail = await request(app)
      .post("/api/auth/login")
      .send({ email: "nobody@example.com", password: "password123" });

    expect(wrongPassword.status).toBe(400);
    expect(unknownEmail.status).toBe(400);
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
  });
});

describe("GET /api/auth/check", () => {
  it("rejects a missing token with 401", async () => {
    const res = await request(app).get("/api/auth/check");
    expect(res.status).toBe(401);
  });

  it("rejects a malformed token with 401, not 500", async () => {
    const res = await request(app).get("/api/auth/check").set("Cookie", "jwt=not-a-jwt");
    expect(res.status).toBe(401);
  });

  it("rejects an expired token with 401, not 500", async () => {
    const user = (await signup(request.agent(app))).body;
    const expired = jwt.sign({ userId: user._id }, ENV.JWT_SECRET, { expiresIn: -10 });

    const res = await request(app).get("/api/auth/check").set("Cookie", `jwt=${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/expired/i);
  });

  it("returns the user without the password hash", async () => {
    const agent = request.agent(app);
    await signup(agent);

    const res = await agent.get("/api/auth/check");
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("ada@example.com");
    expect(res.body.password).toBeUndefined();
  });
});

describe("PUT /api/auth/update-profile", () => {
  it("requires authentication", async () => {
    const res = await request(app)
      .put("/api/auth/update-profile")
      .send({ profilePic: PNG_1PX });
    expect(res.status).toBe(401);
  });

  it("rejects a non-image payload before uploading", async () => {
    const agent = request.agent(app);
    await signup(agent);

    const res = await agent
      .put("/api/auth/update-profile")
      .send({ profilePic: "https://example.com/not-a-data-url.png" });

    expect(res.status).toBe(400);
  });

  it("rejects an oversized image before uploading", async () => {
    const agent = request.agent(app);
    await signup(agent);

    const originalLimit = ENV.MAX_IMAGE_BYTES;
    ENV.MAX_IMAGE_BYTES = 16; // 1x1 PNG is larger than this
    try {
      const res = await agent.put("/api/auth/update-profile").send({ profilePic: PNG_1PX });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/too large/i);
    } finally {
      ENV.MAX_IMAGE_BYTES = originalLimit;
    }
  });

  it("updates the avatar and never leaks the password hash", async () => {
    const agent = request.agent(app);
    await signup(agent);

    const res = await agent.put("/api/auth/update-profile").send({ profilePic: PNG_1PX });

    expect(res.status).toBe(200);
    expect(res.body.profilePic).toContain("cloudinary");
    // Regression: findByIdAndUpdate without a projection used to return the
    // full document, including the bcrypt hash.
    expect(res.body.password).toBeUndefined();
    expect(res.body.profilePicPublicId).toBeUndefined();
  });
});

describe("POST /api/auth/logout", () => {
  it("clears the auth cookie", async () => {
    const agent = request.agent(app);
    await signup(agent);

    const res = await agent.post("/api/auth/logout");
    expect(res.status).toBe(200);

    const cleared = jwtCookie(res);
    expect(cleared).toBeDefined();
    expect(cleared).toMatch(/jwt=;/);

    const check = await agent.get("/api/auth/check");
    expect(check.status).toBe(401);
  });
});
