import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { io as ioClient } from "socket.io-client";

import { app, io, server } from "../src/lib/socket.js";
import { clearDatabase, createUser, startDatabase, stopDatabase } from "./helpers.js";

let baseUrl;

beforeAll(async () => {
  await startDatabase();
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => io.close(resolve));
  await stopDatabase();
});

beforeEach(async () => {
  await clearDatabase();
});

const tokenFrom = (res) => {
  const cookie = (res.headers["set-cookie"] ?? []).find((c) => c.startsWith("jwt="));
  return cookie?.slice("jwt=".length).split(";")[0];
};

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      transports: ["websocket"],
      extraHeaders: { Cookie: `jwt=${token}` },
      reconnection: false,
      timeout: 5000,
    });

    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", (error) => reject(error));
  });
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolve with the next payload for `event` that satisfies `predicate`. */
function nextEventMatching(socket, event, predicate = () => true, ms = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timed out waiting for matching "${event}"`));
    }, ms);

    const handler = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };

    socket.on(event, handler);
  });
}

const onlineListWith = (socket, userId) =>
  nextEventMatching(socket, "getOnlineUsers", (list) => list.includes(userId));

const onlineListWithout = (socket, userId) =>
  nextEventMatching(socket, "getOnlineUsers", (list) => !list.includes(userId));

describe("socket authentication", () => {
  it("rejects a connection without a cookie", async () => {
    await expect(connect("")).rejects.toThrow();
  });

  it("rejects an invalid token", async () => {
    await expect(connect("definitely-not-a-jwt")).rejects.toThrow();
  });
});

describe("real-time features", () => {
  let alice;
  let bob;

  beforeEach(async () => {
    alice = await createUser(app, { email: "alice@example.com", fullName: "Alice" });
    bob = await createUser(app, { email: "bob@example.com", fullName: "Bob" });
  });

  it("announces presence and relays typing indicators", async () => {
    const bobSocket = await connect(tokenFrom(bob.res));
    const aliceSocket = await connect(tokenFrom(alice.res));

    // The connect broadcast can fire before the listener is attached, so wait
    // for the first list that actually contains Alice.
    const onlineList = await onlineListWith(bobSocket, alice.body._id);
    expect(onlineList).toContain(bob.body._id);

    const typing = nextEventMatching(bobSocket, "typing");
    aliceSocket.emit("typing", { receiverId: bob.body._id, isTyping: true });

    expect(await typing).toEqual({ senderId: alice.body._id, isTyping: true });

    aliceSocket.disconnect();
    bobSocket.disconnect();
  });

  it("keeps a user online while another tab is still connected", async () => {
    const bobSocket = await connect(tokenFrom(bob.res));

    const tabOne = await connect(tokenFrom(alice.res));
    await onlineListWith(bobSocket, alice.body._id);

    // Second tab: no presence change to broadcast.
    const tabTwo = await connect(tokenFrom(alice.res));
    await wait(150);

    // Closing the first tab must NOT announce Alice as offline.
    let announcedOffline = false;
    const watcher = (list) => {
      if (!list.includes(alice.body._id)) announcedOffline = true;
    };
    bobSocket.on("getOnlineUsers", watcher);

    tabOne.disconnect();
    await wait(600);
    bobSocket.off("getOnlineUsers", watcher);

    expect(announcedOffline).toBe(false);

    // Closing the last tab does announce it.
    const lastTab = onlineListWithout(bobSocket, alice.body._id);
    tabTwo.disconnect();

    const finalList = await lastTab;
    expect(finalList).toContain(bob.body._id);

    bobSocket.disconnect();
  });

  it("delivers messages and read receipts over the socket", async () => {
    const aliceSocket = await connect(tokenFrom(alice.res));
    const bobSocket = await connect(tokenFrom(bob.res));

    const messagePromise = nextEventMatching(bobSocket, "newMessage");

    const sent = await alice.agent
      .post(`/api/messages/send/${bob.body._id}`)
      .send({ text: "hey bob" });

    expect(sent.status).toBe(201);

    const delivered = await messagePromise;
    expect(delivered._id).toBe(sent.body._id);
    // Bob has a live socket, so the message is marked delivered.
    expect(delivered.status).toBe("delivered");

    const readPromise = nextEventMatching(aliceSocket, "messagesRead");
    const read = await bob.agent.put(`/api/messages/${alice.body._id}/read`);

    expect(read.status).toBe(200);
    expect(await readPromise).toEqual({ by: bob.body._id });

    aliceSocket.disconnect();
    bobSocket.disconnect();
  });

  it("delivers a message to every tab the recipient has open", async () => {
    const bobTabOne = await connect(tokenFrom(bob.res));
    const bobTabTwo = await connect(tokenFrom(bob.res));

    const firstTabMessage = nextEventMatching(bobTabOne, "newMessage");
    const secondTabMessage = nextEventMatching(bobTabTwo, "newMessage");

    await alice.agent.post(`/api/messages/send/${bob.body._id}`).send({ text: "to both tabs" });

    const [one, two] = await Promise.all([firstTabMessage, secondTabMessage]);
    expect(one._id).toBe(two._id);

    bobTabOne.disconnect();
    bobTabTwo.disconnect();
  });

  it("delivers a message to the sender's other tabs", async () => {
    const tabOne = await connect(tokenFrom(alice.res));
    const tabTwo = await connect(tokenFrom(alice.res));

    const otherTabMessage = nextEventMatching(tabTwo, "newMessage");

    await alice.agent.post(`/api/messages/send/${bob.body._id}`).send({ text: "from tab one" });

    const mirrored = await otherTabMessage;
    expect(mirrored.text).toBe("from tab one");

    tabOne.disconnect();
    tabTwo.disconnect();
  });
});
