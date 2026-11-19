import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import mongoose from "mongoose";

import { app, io } from "../src/lib/socket.js";
import Message from "../src/models/Message.js";
import { clearDatabase, createUser, startDatabase, stopDatabase } from "./helpers.js";

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

const send = (agent, toId, body = { text: "hello" }) =>
  agent.post(`/api/messages/send/${toId}`).send(body);

describe("message route protection", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(app).get("/api/messages/contacts");
    expect(res.status).toBe(401);
  });

  it("rejects a malformed user id with 400 instead of a CastError 500", async () => {
    const { agent } = await createUser(app, { email: "a@example.com" });

    const res = await agent.get("/api/messages/not-an-object-id");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid/i);
  });
});

describe("POST /api/messages/send/:id", () => {
  it("rejects empty messages", async () => {
    const { agent, body } = await createUser(app, { email: "a@example.com" });
    const other = await createUser(app, { email: "b@example.com" });

    const res = await send(agent, other.body._id, { text: "   " });
    expect(res.status).toBe(400);
  });

  it("rejects messaging yourself", async () => {
    const { agent, body } = await createUser(app, { email: "a@example.com" });
    const res = await send(agent, body._id);
    expect(res.status).toBe(400);
  });

  it("rejects an unknown receiver with 404", async () => {
    const { agent } = await createUser(app, { email: "a@example.com" });
    const res = await send(agent, new mongoose.Types.ObjectId().toString());
    expect(res.status).toBe(404);
  });

  it("stores the message and returns it to the sender", async () => {
    const { agent } = await createUser(app, { email: "a@example.com" });
    const other = await createUser(app, { email: "b@example.com" });

    const res = await send(agent, other.body._id, { text: "  hi there  " });

    expect(res.status).toBe(201);
    expect(res.body.text).toBe("hi there"); // trimmed
    expect(res.body.status).toBe("sent"); // receiver is offline in tests
    expect(res.body.senderId).toBeDefined();
    expect(await Message.countDocuments({})).toBe(1);
  });

  it("rejects an image that is not a base64 data URL", async () => {
    const { agent } = await createUser(app, { email: "a@example.com" });
    const other = await createUser(app, { email: "b@example.com" });

    const res = await send(agent, other.body._id, { image: "https://evil.example/x.png" });
    expect(res.status).toBe(400);
    expect(await Message.countDocuments({})).toBe(0);
  });
});

describe("GET /api/messages/:id", () => {
  it("returns the conversation for both participants only", async () => {
    const a = await createUser(app, { email: "a@example.com" });
    const b = await createUser(app, { email: "b@example.com" });
    const c = await createUser(app, { email: "c@example.com" });

    await send(a.agent, b.body._id, { text: "for b" });

    const asA = await a.agent.get(`/api/messages/${b.body._id}`);
    const asB = await b.agent.get(`/api/messages/${a.body._id}`);
    // A stranger must not be able to read someone else's thread.
    const asC = await c.agent.get(`/api/messages/${a.body._id}`);

    expect(asA.status).toBe(200);
    expect(asA.body.messages).toHaveLength(1);
    expect(asB.body.messages).toHaveLength(1);
    expect(asC.body.messages).toHaveLength(0);
    expect(asA.body.hasMore).toBe(false);
  });

  it("paginates with a cursor and never overlaps pages", async () => {
    const a = await createUser(app, { email: "a@example.com" });
    const b = await createUser(app, { email: "b@example.com" });

    const base = Date.now() - 35_000;
    await Message.create(
      Array.from({ length: 35 }, (_, index) => ({
        senderId: a.body._id,
        receiverId: b.body._id,
        text: `message-${index}`,
        createdAt: new Date(base + index * 1000),
        updatedAt: new Date(base + index * 1000),
      }))
    );

    const first = await a.agent.get(`/api/messages/${b.body._id}?limit=10`);
    expect(first.status).toBe(200);
    expect(first.body.messages).toHaveLength(10);
    expect(first.body.hasMore).toBe(true);
    // Newest page, returned oldest-first for rendering.
    expect(first.body.messages.at(-1).text).toBe("message-34");

    const before = encodeURIComponent(first.body.messages[0].createdAt);
    const second = await a.agent.get(`/api/messages/${b.body._id}?limit=10&before=${before}`);

    expect(second.body.messages).toHaveLength(10);
    expect(second.body.messages.at(-1).text).toBe("message-24");

    const firstIds = new Set(first.body.messages.map((m) => m._id));
    const overlap = second.body.messages.filter((m) => firstIds.has(m._id));
    expect(overlap).toHaveLength(0);
  });

  it("clamps an absurd page size", async () => {
    const a = await createUser(app, { email: "a@example.com" });
    const b = await createUser(app, { email: "b@example.com" });

    const res = await a.agent.get(`/api/messages/${b.body._id}?limit=100000`);
    expect(res.status).toBe(200);
    expect(res.body.messages.length).toBeLessThanOrEqual(100);
  });
});

describe("GET /api/messages/chats", () => {
  it("returns partners with the last message and unread count", async () => {
    const a = await createUser(app, { email: "a@example.com" });
    const b = await createUser(app, { email: "b@example.com" });

    await send(a.agent, b.body._id, { text: "first" });
    await send(a.agent, b.body._id, { text: "second" });
    await send(b.agent, a.body._id, { text: "reply" });

    const asA = await a.agent.get("/api/messages/chats");
    const asB = await b.agent.get("/api/messages/chats");

    expect(asA.status).toBe(200);
    expect(asA.body).toHaveLength(1);
    expect(asA.body[0].fullName).toBeDefined();
    expect(asA.body[0].password).toBeUndefined();
    expect(asA.body[0].lastMessage.text).toBe("reply");
    expect(asA.body[0].unreadCount).toBe(1);
    expect(asB.body[0].unreadCount).toBe(2);
  });

  it("orders conversations by most recent activity", async () => {
    const a = await createUser(app, { email: "a@example.com" });
    const b = await createUser(app, { email: "b@example.com" });
    const c = await createUser(app, { email: "c@example.com" });

    await send(a.agent, b.body._id, { text: "older" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    await send(a.agent, c.body._id, { text: "newer" });

    const res = await a.agent.get("/api/messages/chats");
    expect(res.body.map((chat) => chat._id)).toEqual([c.body._id, b.body._id]);
  });
});

describe("PUT /api/messages/:id/read", () => {
  it("marks incoming messages as read and clears the unread counter", async () => {
    const a = await createUser(app, { email: "a@example.com" });
    const b = await createUser(app, { email: "b@example.com" });

    await send(a.agent, b.body._id, { text: "unread one" });
    await send(a.agent, b.body._id, { text: "unread two" });

    const beforeRead = await b.agent.get("/api/messages/chats");
    expect(beforeRead.body[0].unreadCount).toBe(2);

    const res = await b.agent.put(`/api/messages/${a.body._id}/read`);
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(2);

    const stored = await Message.find({ senderId: a.body._id });
    expect(stored.every((message) => message.status === "read")).toBe(true);
    expect(stored.every((message) => message.readAt instanceof Date)).toBe(true);

    const afterRead = await b.agent.get("/api/messages/chats");
    expect(afterRead.body[0].unreadCount).toBe(0);
  });

  it("does not let a stranger mark someone else's messages read", async () => {
    const a = await createUser(app, { email: "a@example.com" });
    const b = await createUser(app, { email: "b@example.com" });
    const c = await createUser(app, { email: "c@example.com" });

    await send(a.agent, b.body._id, { text: "private" });

    const res = await c.agent.put(`/api/messages/${a.body._id}/read`);
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(0);

    const stored = await Message.findOne({});
    expect(stored.status).toBe("sent");
  });
});

describe("GET /api/messages/contacts", () => {
  it("lists everyone except the caller, without password hashes", async () => {
    const a = await createUser(app, { email: "a@example.com" });
    await createUser(app, { email: "b@example.com", fullName: "Bob" });

    const res = await a.agent.get("/api/messages/contacts");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].fullName).toBe("Bob");
    expect(res.body[0].password).toBeUndefined();
  });
});
