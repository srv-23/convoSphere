import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
      // Never returned by default: the hash must be opted into explicitly.
      select: false,
    },
    profilePic: {
      type: String,
      default: "",
    },
    // Cloudinary public_id of the current avatar, so replacing an avatar can
    // delete the old asset instead of leaking storage.
    profilePicPublicId: {
      type: String,
      default: "",
      select: false,
    },
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

export default User;
