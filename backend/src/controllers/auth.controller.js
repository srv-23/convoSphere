import bcrypt from "bcryptjs";

import { sendWelcomeEmail } from "../emails/emailHandlers.js";
import { clearToken, generateToken, normalizeEmail, normalizeText } from "../lib/utils.js";
import { validateImagePayload, IMAGE_FOLDERS, IMAGE_TRANSFORMS } from "../lib/images.js";
import User from "../models/User.js";
import { ENV } from "../lib/env.js";
import cloudinary from "../lib/cloudinary.js";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const publicUser = (user) => ({
  _id: user._id,
  fullName: user.fullName,
  email: user.email,
  profilePic: user.profilePic,
});

export const signup = async (req, res, next) => {
  try {
    const fullName = normalizeText(req.body?.fullName);
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!fullName || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }
    if (fullName.length > 50) {
      return res.status(400).json({ message: "Full name must be 50 characters or fewer" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }
    if (password.length > 128) {
      return res.status(400).json({ message: "Password must be 128 characters or fewer" });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const savedUser = await User.create({ fullName, email, password: hashedPassword });

    // Persist first, then issue the cookie: the token must never reference a
    // user that failed to save.
    generateToken(savedUser._id, res);

    res.status(201).json(publicUser(savedUser));

    // Email is a side effect of a successful signup, not part of it. A Resend
    // outage must not fail account creation, and must not delay the response.
    sendWelcomeEmail(savedUser.email, savedUser.fullName, ENV.CLIENT_URL).catch((error) => {
      console.error("Failed to send welcome email:", error.message);
    });
  } catch (error) {
    next(error);
  }
};

export const login = async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    // password has select:false on the schema, so it must be asked for.
    const user = await User.findOne({ email }).select("+password");

    // Same response for unknown email and wrong password: never reveal which.
    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    generateToken(user._id, res);
    res.status(200).json(publicUser(user));
  } catch (error) {
    next(error);
  }
};

export const logout = (_req, res) => {
  clearToken(res);
  res.status(200).json({ message: "Logged out successfully" });
};

export const updateProfile = async (req, res, next) => {
  try {
    const { profilePic } = req.body ?? {};

    if (!profilePic) {
      return res.status(400).json({ message: "Profile pic is required" });
    }

    // Validate before spending money on an upload.
    const imageCheck = validateImagePayload(profilePic);
    if (!imageCheck.ok) {
      return res.status(400).json({ message: imageCheck.message });
    }

    const userId = req.user._id;

    // profilePicPublicId is select:false, so read it explicitly for cleanup.
    const currentUser = await User.findById(userId).select("+profilePicPublicId");

    const uploadResponse = await cloudinary.uploader.upload(profilePic, {
      folder: IMAGE_FOLDERS.avatar,
      transformation: IMAGE_TRANSFORMS.avatar,
      resource_type: "image",
    });

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        profilePic: uploadResponse.secure_url,
        profilePicPublicId: uploadResponse.public_id,
      },
      { new: true, runValidators: true }
    ).select("-password -profilePicPublicId");

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Replacing an avatar used to leave the previous asset in Cloudinary
    // forever. Deletion is best-effort: it must not fail the request.
    const previousPublicId = currentUser?.profilePicPublicId;
    if (previousPublicId && previousPublicId !== uploadResponse.public_id) {
      cloudinary.uploader
        .destroy(previousPublicId, { resource_type: "image" })
        .catch((error) => console.error("Failed to delete old avatar:", error.message));
    }

    res.status(200).json(updatedUser);
  } catch (error) {
    next(error);
  }
};
