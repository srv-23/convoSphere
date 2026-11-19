// Thin indirection over Socket.io so controllers can push events without
// importing the socket server (that would create an import cycle:
// socket -> app -> routes -> controllers -> socket).
//
// Every authenticated socket joins a per-user room, so emitting to a room
// reaches all of that user's tabs instead of a single socket id.

let io = null;

export function bindIO(instance) {
  io = instance;
  return io;
}

export function getIO() {
  return io;
}

export const userRoom = (userId) => `user:${String(userId)}`;

/**
 * Emit an event to every socket of a user.
 * @returns {boolean} true when the realtime layer is available
 */
export function emitToUser(userId, event, payload) {
  if (!io || !userId) return false;
  io.to(userRoom(userId)).emit(event, payload);
  return true;
}
