import { Server } from "socket.io";
import http from "http";
import mongoose from "mongoose";

import { ENV } from "./env.js";
import { createApp } from "./app.js";
import { bindIO, userRoom } from "./realtime.js";
import { addSocket, removeSocket, getOnlineUserIds, onlineCount } from "./presence.js";
import { socketAuthMiddleware } from "../middleware/socket.auth.middleware.js";

const app = createApp();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: [ENV.CLIENT_URL],
    credentials: true,
  },
});

bindIO(io);

// Authenticate every socket before it joins a room.
io.use(socketAuthMiddleware);

// Lightweight flood guard for client-emitted events. Typing fires on every
// keystroke, so it is the easiest event to abuse.
const EVENT_BUDGET = 40;
const EVENT_WINDOW_MS = 5000;

function withinEventBudget(socket) {
  const now = Date.now();
  const state = socket.data.eventBudget ?? { count: 0, resetAt: now + EVENT_WINDOW_MS };

  if (now > state.resetAt) {
    state.count = 0;
    state.resetAt = now + EVENT_WINDOW_MS;
  }

  state.count += 1;
  socket.data.eventBudget = state;

  return state.count <= EVENT_BUDGET;
}

io.on("connection", (socket) => {
  const userId = socket.userId;

  // A per-user room means every tab/device receives events addressed to the
  // user, not just the single socket id we happened to store last.
  socket.join(userRoom(userId));

  const isFirstSocket = addSocket(userId, socket.id);
  console.log(`A user connected: ${socket.user.fullName} (${onlineCount()} online)`);

  // Only broadcast when someone actually goes online/offline. The previous
  // version re-broadcast the whole presence list on every connect and
  // disconnect, so cost grew with tabs instead of users.
  if (isFirstSocket) {
    io.emit("getOnlineUsers", getOnlineUserIds());
  }

  socket.on("typing", ({ receiverId, isTyping } = {}) => {
    if (!withinEventBudget(socket)) return;
    if (!receiverId || !mongoose.isValidObjectId(receiverId)) return;
    if (String(receiverId) === userId) return;

    io.to(userRoom(receiverId)).emit("typing", {
      senderId: userId,
      isTyping: Boolean(isTyping),
    });
  });

  socket.on("disconnect", () => {
    const isLastSocket = removeSocket(userId, socket.id);

    if (isLastSocket) {
      io.emit("getOnlineUsers", getOnlineUserIds());
      console.log(`A user disconnected: ${socket.user.fullName} (${onlineCount()} online)`);
    }
  });
});

export { io, app, server };
