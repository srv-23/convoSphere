// Tracks which sockets belong to which user.
//
// A user can have many open tabs/devices, so this is a
// Map<userId, Set<socketId>>. The previous implementation was
// { userId: socketId }, which meant opening a second tab overwrote the
// first entry and closing either tab marked the user offline while they
// were still connected.

const socketsByUser = new Map();

/**
 * Register a socket for a user.
 * @returns {boolean} true when this is the user's first live socket
 */
export function addSocket(userId, socketId) {
  const id = String(userId);
  const existing = socketsByUser.get(id);
  const isFirstSocket = !existing || existing.size === 0;

  if (existing) {
    existing.add(socketId);
  } else {
    socketsByUser.set(id, new Set([socketId]));
  }

  return isFirstSocket;
}

/**
 * Unregister a socket for a user.
 * @returns {boolean} true when the user has no sockets left (went offline)
 */
export function removeSocket(userId, socketId) {
  const id = String(userId);
  const sockets = socketsByUser.get(id);

  if (!sockets) return true;

  sockets.delete(socketId);

  if (sockets.size === 0) {
    socketsByUser.delete(id);
    return true;
  }

  // Another tab/device is still connected: the user is still online.
  return false;
}

export function getSocketIds(userId) {
  return [...(socketsByUser.get(String(userId)) ?? [])];
}

export function isOnline(userId) {
  return (socketsByUser.get(String(userId))?.size ?? 0) > 0;
}

export function getOnlineUserIds() {
  return [...socketsByUser.keys()];
}

export function onlineCount() {
  return socketsByUser.size;
}

/** Test helper: clear all presence state between test cases. */
export function resetPresence() {
  socketsByUser.clear();
}
