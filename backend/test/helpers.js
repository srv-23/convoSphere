import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";

let mongo;

/** Start a throwaway MongoDB and connect Mongoose to it. */
export async function startDatabase() {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri(), { dbName: "convosphere-test" });
  return mongo;
}

export async function stopDatabase() {
  await mongoose.disconnect();
  await mongo?.stop();
  mongo = undefined;
}

export async function clearDatabase() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

/**
 * Create an account through the real signup endpoint and return an agent
 * (cookie jar) plus the user body. Using the API keeps the cookie options
 * under test instead of hand-forging a token.
 */
export async function createUser(app, { fullName = "Test User", email, password = "password123" } = {}) {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/signup").send({ fullName, email, password });

  return { agent, body: res.body, res };
}

export const cookieHeader = (res) => res.headers["set-cookie"] ?? [];
