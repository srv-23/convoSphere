import mongoose from "mongoose";

import cloudinary from "../lib/cloudinary.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import { emitToUser } from "../lib/realtime.js";
import { isOnline } from "../lib/presence.js";
import { clampLimit, normalizeText } from "../lib/utils.js";
import { validateImagePayload, IMAGE_FOLDERS, IMAGE_TRANSFORMS } from "../lib/images.js";
import { ENV } from "../lib/env.js";

const MAX_TEXT_LENGTH = 2000;

const assertObjectId = (value, res, label = "id") => {
  if (!mongoose.isValidObjectId(value)) {
    res.status(400).json({ message: `Invalid ${label}` });
    return false;
  }
  return true;
};

export const getAllContacts = async (req, res, next) => {
  try {
    const loggedInUserId = req.user._id;
    const contacts = await User.find({ _id: { $ne: loggedInUserId } })
      .select("fullName email profilePic")
      .sort({ fullName: 1 })
      .lean();

    res.status(200).json(contacts);
  } catch (error) {
    next(error);
  }
};

export const getMessagesByUserId = async (req, res, next) => {
  try {
    const myId = req.user._id;
    const { id: userToChatId } = req.params;

    if (!assertObjectId(userToChatId, res, "user id")) return;

    // Cursor pagination: load the newest page, then older pages on demand.
    // Previously the whole conversation was returned in one response.
    const limit = clampLimit(req.query.limit, ENV.MESSAGE_PAGE_SIZE);
    const before = req.query.before ? new Date(req.query.before) : null;

    const filter = {
      $or: [
        { senderId: myId, receiverId: userToChatId },
        { senderId: userToChatId, receiverId: myId },
      ],
    };

    if (before && !Number.isNaN(before.getTime())) {
      filter.createdAt = { $lt: before };
    }

    const docs = await Message.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = docs.length > limit;
    const page = hasMore ? docs.slice(0, limit) : docs;
    page.reverse(); // oldest first, the order the UI renders

    res.status(200).json({ messages: page, hasMore });
  } catch (error) {
    next(error);
  }
};

export const sendMessage = async (req, res, next) => {
  try {
    const { text, image } = req.body ?? {};
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    if (!assertObjectId(receiverId, res, "receiver id")) return;

    const cleanText = normalizeText(text);

    if (!cleanText && !image) {
      return res.status(400).json({ message: "Text or image is required." });
    }
    if (cleanText.length > MAX_TEXT_LENGTH) {
      return res.status(400).json({ message: `Message must be ${MAX_TEXT_LENGTH} characters or fewer` });
    }
    if (String(senderId) === String(receiverId)) {
      return res.status(400).json({ message: "Cannot send messages to yourself." });
    }

    const receiverExists = await User.exists({ _id: receiverId });
    if (!receiverExists) {
      return res.status(404).json({ message: "Receiver not found." });
    }

    let imageUrl;
    if (image) {
      const imageCheck = validateImagePayload(image);
      if (!imageCheck.ok) {
        return res.status(400).json({ message: imageCheck.message });
      }

      const uploadResponse = await cloudinary.uploader.upload(image, {
        folder: IMAGE_FOLDERS.message,
        transformation: IMAGE_TRANSFORMS.message,
        resource_type: "image",
      });
      imageUrl = uploadResponse.secure_url;
    }

    const newMessage = await Message.create({
      senderId,
      receiverId,
      text: cleanText || undefined,
      image: imageUrl,
      // Optimistic delivery state: delivered means it reached a live socket.
      status: isOnline(receiverId) ? "delivered" : "sent",
    });

    const payload = newMessage.toObject();

    // Receiver: the message itself. Sender: sync every tab, so a message sent
    // from one tab does not stay invisible in another.
    emitToUser(receiverId, "newMessage", payload);
    emitToUser(senderId, "newMessage", payload);

    res.status(201).json(payload);
  } catch (error) {
    next(error);
  }
};

/**
 * Mark every unread message from `:id` to me as read, and tell the other
 * side so it can render read receipts.
 */
export const markConversationRead = async (req, res, next) => {
  try {
    const myId = req.user._id;
    const { id: otherUserId } = req.params;

    if (!assertObjectId(otherUserId, res, "user id")) return;

    const result = await Message.updateMany(
      { senderId: otherUserId, receiverId: myId, status: { $ne: "read" } },
      { $set: { status: "read", readAt: new Date() } }
    );

    if (result.modifiedCount > 0) {
      emitToUser(otherUserId, "messagesRead", { by: String(myId) });
    }

    res.status(200).json({ updated: result.modifiedCount });
  } catch (error) {
    next(error);
  }
};

export const getChatPartners = async (req, res, next) => {
  try {
    const loggedInUserId = req.user._id;

    // Done in the database. The previous version pulled every message the
    // user had ever exchanged into Node and de-duplicated them in JS, which
    // grows with history instead of with the number of conversations.
    const rows = await Message.aggregate([
      { $match: { $or: [{ senderId: loggedInUserId }, { receiverId: loggedInUserId }] } },
      {
        $addFields: {
          partnerId: {
            $cond: [{ $eq: ["$senderId", loggedInUserId] }, "$receiverId", "$senderId"],
          },
        },
      },
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $group: {
          _id: "$partnerId",
          lastMessage: { $first: "$$ROOT" },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$receiverId", loggedInUserId] },
                    { $ne: ["$status", "read"] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
      { $unwind: "$user" },
      {
        $project: {
          lastMessage: 1,
          unreadCount: 1,
          fullName: "$user.fullName",
          email: "$user.email",
          profilePic: "$user.profilePic",
        },
      },
      { $sort: { "lastMessage.createdAt": -1 } },
    ]);

    res.status(200).json(
      rows.map((row) => ({
        _id: row._id,
        fullName: row.fullName,
        email: row.email,
        profilePic: row.profilePic,
        unreadCount: row.unreadCount,
        lastMessage: {
          _id: row.lastMessage._id,
          text: row.lastMessage.text,
          image: row.lastMessage.image,
          senderId: row.lastMessage.senderId,
          receiverId: row.lastMessage.receiverId,
          status: row.lastMessage.status,
          createdAt: row.lastMessage.createdAt,
        },
      }))
    );
  } catch (error) {
    next(error);
  }
};
