import jwt from "jsonwebtoken";
import User from "../models/User.js";
import { ENV } from "../lib/env.js";

export const protectRoute = async (req, res, next) => {
  const token = req.cookies?.jwt;

  if (!token) {
    return res.status(401).json({ message: "Unauthorized - No token provided" });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, ENV.JWT_SECRET);
  } catch {
    // verify() throws on both malformed and expired tokens. The old code
    // let that bubble into the generic catch and answered 500, so a user
    // with an expired session was told the server was broken.
    return res.status(401).json({ message: "Unauthorized - Invalid or expired token" });
  }

  try {
    // password is excluded by the schema, this is belt and braces
    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
      return res.status(401).json({ message: "Unauthorized - User no longer exists" });
    }

    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
};
