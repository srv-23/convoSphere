import mongoose from "mongoose";

export const MESSAGE_STATUSES = ["sent", "delivered", "read"];

const messageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    image: {
      type: String,
    },
    status: {
      type: String,
      enum: MESSAGE_STATUSES,
      default: "sent",
    },
    readAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Conversation history: "messages between A and B, newest first".
messageSchema.index({ senderId: 1, receiverId: 1, createdAt: -1 });
// Chat partner aggregation and unread counts, which match on one side only.
messageSchema.index({ receiverId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1, createdAt: -1 });

const Message = mongoose.model("Message", messageSchema);

export default Message;
