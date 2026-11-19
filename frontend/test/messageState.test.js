import { describe, expect, it } from "vitest";
import {
  applyReadReceipt,
  addOptimistic,
  bumpChat,
  dropOptimistic,
  isOptimistic,
  markChatRead,
  prependOlder,
  reconcileOptimistic,
  upsertMessage,
} from "../src/store/messageState.js";

const msg = (id, extra = {}) => ({
  _id: id,
  senderId: "me",
  receiverId: "them",
  text: id,
  createdAt: new Date(2024, 0, 1, 0, 0, Number(id) || 0).toISOString(),
  ...extra,
});

describe("optimistic send reconciliation", () => {
  it("adds a temporary message to the end", () => {
    const result = addOptimistic([msg("1")], msg("temp-1", { isOptimistic: true }));
    expect(result).toHaveLength(2);
    expect(isOptimistic(result.at(-1))).toBe(true);
  });

  it("replaces the temporary message with the server copy", () => {
    const optimistic = msg("temp-abc", { isOptimistic: true });
    const saved = msg("99", { text: "hello" });

    const result = reconcileOptimistic([msg("1"), optimistic], optimistic._id, saved);

    expect(result.map((m) => m._id)).toEqual(["1", "99"]);
    expect(result.some((m) => isOptimistic(m))).toBe(false);
  });

  it("does not duplicate a message that arrived over the socket first", () => {
    // Regression: the socket delivers the same message while the POST is in
    // flight. Both the optimistic temp and the socket copy must collapse.
    const optimistic = msg("temp-abc", { isOptimistic: true });
    const saved = msg("99");

    const result = reconcileOptimistic([msg("1"), optimistic, saved], optimistic._id, saved);

    expect(result.map((m) => m._id)).toEqual(["1", "99"]);
  });

  it("removes only the failed temporary message", () => {
    const optimistic = msg("temp-abc", { isOptimistic: true });
    const result = dropOptimistic([msg("1"), optimistic], optimistic._id);

    expect(result.map((m) => m._id)).toEqual(["1"]);
  });

  it("keeps an incoming socket message when a send resolves afterwards", () => {
    // The old store wrote back a pre-await snapshot and lost this message.
    const optimistic = msg("temp-abc", { isOptimistic: true });
    const incoming = msg("5", { senderId: "them", receiverId: "me" });
    const saved = msg("99");

    const afterSocket = upsertMessage([msg("1"), optimistic], incoming);
    const afterSend = reconcileOptimistic(afterSocket, optimistic._id, saved);

    expect(afterSend.map((m) => m._id).sort()).toEqual(["1", "5", "99"]);
  });

  it("is idempotent when the same incoming message arrives twice", () => {
    const incoming = msg("5");

    const once = upsertMessage([msg("1")], incoming);
    const twice = upsertMessage(once, incoming);

    expect(twice).toHaveLength(2);
    expect(twice).toBe(once);
  });
});

describe("pagination merge", () => {
  it("prepends older messages in chronological order", () => {
    const result = prependOlder([msg("1"), msg("2")], [msg("3")]);
    expect(result.map((m) => m._id)).toEqual(["1", "2", "3"]);
  });

  it("skips messages that are already loaded", () => {
    const result = prependOlder([msg("1"), msg("2")], [msg("2"), msg("3")]);
    expect(result.map((m) => m._id)).toEqual(["1", "2", "3"]);
  });
});

describe("read receipts", () => {
  it("marks only messages addressed to the reader", () => {
    const messages = [
      msg("1", { senderId: "me", receiverId: "them", status: "sent" }),
      msg("2", { senderId: "them", receiverId: "me", status: "sent" }),
      msg("3", { senderId: "me", receiverId: "someone-else", status: "sent" }),
    ];

    const result = applyReadReceipt(messages, "them");

    expect(result[0].status).toBe("read");
    expect(result[0].readAt).toBeDefined();
    expect(result[1].status).toBe("sent");
    expect(result[2].status).toBe("sent");
  });
});

describe("chat list updates", () => {
  const chats = [
    { _id: "them", fullName: "Them", unreadCount: 0, lastMessage: null },
    { _id: "other", fullName: "Other", unreadCount: 3, lastMessage: null },
  ];

  it("moves an active conversation to the top", () => {
    const result = bumpChat(chats, msg("5", { receiverId: "other" }), "me");
    expect(result[0]._id).toBe("other");
    expect(result[1]._id).toBe("them");
  });

  it("counts only incoming messages as unread", () => {
    const outgoing = bumpChat(chats, msg("5", { senderId: "me" }), "me");
    expect(outgoing.find((c) => c._id === "them").unreadCount).toBe(0);

    const incoming = bumpChat(
      chats,
      msg("6", { senderId: "them", receiverId: "me" }),
      "me"
    );
    expect(incoming.find((c) => c._id === "them").unreadCount).toBe(1);
  });

  it("clears the unread counter for the open conversation", () => {
    const result = markChatRead(chats, "other");
    expect(result.find((c) => c._id === "other").unreadCount).toBe(0);
  });

  it("leaves the list untouched for an unknown partner", () => {
    const result = bumpChat(chats, msg("7", { senderId: "stranger", receiverId: "me" }), "me");
    expect(result).toBe(chats);
  });
});
