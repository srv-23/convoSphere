import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { ENV } from "../lib/env.js";

const readCookie = (cookieHeader, name) =>
  cookieHeader
    ?.split("; ")
    .find((row) => row.startsWith(`${name}=`))
    ?.slice(name.length + 1);

export const socketAuthMiddleware = async (socket, next) => {
  try {
    const token = readCookie(socket.handshake.headers.cookie, "jwt");

    if (!token) {
      return next(new Error("Unauthorized - No Token Provided"));
    }

    let decoded;
    try {
      decoded = jwt.verify(token, ENV.JWT_SECRET);
    } catch {
      return next(new Error("Unauthorized - Invalid or expired token"));
    }

    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
      return next(new Error("Unauthorized - User not found"));
    }

    socket.user = user;
    socket.userId = user._id.toString();

    next();
  } catch (error) {
    console.log("Error in socket authentication:", error.message);
    next(new Error("Unauthorized - Authentication failed"));
  }
};
