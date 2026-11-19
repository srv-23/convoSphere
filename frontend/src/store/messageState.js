// Pure message-list transitions.
//
// The store used to snapshot `messages` before an await and write that stale
// snapshot back afterwards, which silently dropped anything that arrived in
// between (a socket message, or a second send). Every function here is
// idempotent and operates on the array it is given, so the store can always
// read `get().messages` at write time.

export const OPTIMISTIC_PREFIX = "temp-";

export function isOptimistic(message) {
  return typeof message?._id === "string" && message._id.startsWith(OPTIMISTIC_PREFIX);
}

const timeOf = (message) => {
  const value = new Date(message?.createdAt ?? 0).getTime();
  return Number.isNaN(value) ? 0 : value;
};

/** Stable chronological sort (oldest first). */
export function sortMessages(messages) {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => timeOf(a.message) - timeOf(b.message) || a.index - b.index)
    .map(({ message }) => message);
}

export function addOptimistic(messages, optimistic) {
  // Deliberately not sorted: an optimistic message is the newest by
  // definition, and relying on the client clock to place it is fragile.
  return [...messages, optimistic];
}

/**
 * Replace a temporary message with the server's copy.
 * Removes the server copy if the socket already delivered it, so the same
 * message cannot appear twice.
 */
export function reconcileOptimistic(messages, tempId, saved) {
  const withoutPending = messages.filter((m) => m._id !== tempId && m._id !== saved._id);
  return sortMessages([...withoutPending, saved]);
}

export function dropOptimistic(messages, tempId) {
  return messages.filter((m) => m._id !== tempId);
}

/** Insert or replace by _id. Returns the same array when nothing changed. */
export function upsertMessage(messages, incoming) {
  if (!incoming?._id) return messages;

  const index = messages.findIndex((m) => m._id === incoming._id);

  if (index === -1) {
    return sortMessages([...messages, incoming]);
  }

  const merged = { ...messages[index], ...incoming };
  const existing = messages[index];
  const keys = Object.keys(merged);

  // A duplicate delivery of an unchanged message should not cause a render.
  if (keys.length === Object.keys(existing).length && keys.every((k) => existing[k] === merged[k])) {
    return messages;
  }

  const next = messages.slice();
  next[index] = merged;
  return sortMessages(next);
}

/** Prepend an older page, skipping anything already loaded. */
export function prependOlder(older, current) {
  const seen = new Set(current.map((m) => m._id));
  const unique = older.filter((m) => !seen.has(m._id));
  return sortMessages([...unique, ...current]);
}

/** Mark every message I sent to `readerId` as read. */
export function applyReadReceipt(messages, readerId) {
  return messages.map((message) => {
    const wasSentToReader = String(message.receiverId) === String(readerId);
    if (!wasSentToReader || message.status === "read") return message;
    return { ...message, status: "read", readAt: message.readAt ?? new Date().toISOString() };
  });
}

export function markChatRead(chats, userId) {
  return chats.map((chat) =>
    String(chat._id) === String(userId) ? { ...chat, unreadCount: 0 } : chat
  );
}

/**
 * Update the chat list entry for a message: newest first, plus unread count
 * for incoming messages. Returns the list unchanged when the partner is not
 * in it yet (the caller refetches in that case).
 */
export function bumpChat(chats, message, myId) {
  const fromMe = String(message.senderId) === String(myId);
  const partnerId = String(fromMe ? message.receiverId : message.senderId);
  const index = chats.findIndex((chat) => String(chat._id) === partnerId);

  if (index === -1) return chats;

  const existing = chats[index];
  const updated = {
    ...existing,
    lastMessage: {
      _id: message._id,
      text: message.text,
      image: message.image,
      senderId: message.senderId,
      receiverId: message.receiverId,
      status: message.status,
      createdAt: message.createdAt,
    },
    unreadCount: fromMe ? 0 : (existing.unreadCount ?? 0) + 1,
  };

  return [updated, ...chats.filter((_, i) => i !== index)];
}
