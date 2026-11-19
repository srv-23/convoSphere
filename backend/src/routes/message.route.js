import express from "express";
import {
  getAllContacts,
  getChatPartners,
  getMessagesByUserId,
  markConversationRead,
  sendMessage,
} from "../controllers/message.controller.js";
import { protectRoute } from "../middleware/auth.middleware.js";
import { arcjetProtection } from "../middleware/arcjet.middleware.js";

const router = express.Router();

// Order matters: rate limit before auth, so unauthenticated floods are
// rejected without a database lookup.
router.use(arcjetProtection, protectRoute);

router.get("/contacts", getAllContacts);
router.get("/chats", getChatPartners);
router.get("/:id", getMessagesByUserId);
router.post("/send/:id", sendMessage);
router.put("/:id/read", markConversationRead);

export default router;
