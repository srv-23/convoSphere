import { create } from "zustand";
import toast from "react-hot-toast";
import { io } from "socket.io-client";

import { axiosInstance } from "../lib/axios";
import { useChatStore } from "./useChatStore";

const BASE_URL = import.meta.env.MODE === "development" ? "http://localhost:3000" : "/";

export const useAuthStore = create((set, get) => ({
  authUser: null,
  isCheckingAuth: true,
  isSigningUp: false,
  isLoggingIn: false,
  socket: null,
  onlineUsers: [],

  checkAuth: async () => {
    try {
      const res = await axiosInstance.get("/auth/check");
      set({ authUser: res.data });
      get().connectSocket();
    } catch {
      set({ authUser: null });
    } finally {
      set({ isCheckingAuth: false });
    }
  },

  signup: async (data) => {
    set({ isSigningUp: true });
    try {
      const res = await axiosInstance.post("/auth/signup", data);
      set({ authUser: res.data });
      toast.success("Account created successfully!");
      get().connectSocket();
    } catch (error) {
      toast.error(error.response?.data?.message ?? "Signup failed");
    } finally {
      set({ isSigningUp: false });
    }
  },

  login: async (data) => {
    set({ isLoggingIn: true });
    try {
      const res = await axiosInstance.post("/auth/login", data);
      set({ authUser: res.data });
      toast.success("Logged in successfully");
      get().connectSocket();
    } catch (error) {
      toast.error(error.response?.data?.message ?? "Login failed");
    } finally {
      set({ isLoggingIn: false });
    }
  },

  logout: async () => {
    try {
      await axiosInstance.post("/auth/logout");
    } catch {
      // Even if the request fails, the local session is over.
    } finally {
      get().disconnectSocket();
      // Drop the previous user's contacts, chats and messages.
      useChatStore.getState().reset();
      set({ authUser: null, onlineUsers: [] });
      toast.success("Logged out successfully");
    }
  },

  updateProfile: async (data) => {
    try {
      const res = await axiosInstance.put("/auth/update-profile", data);
      set({ authUser: res.data });
      toast.success("Profile updated successfully");
    } catch (error) {
      toast.error(error.response?.data?.message ?? "Update failed");
    }
  },

  connectSocket: () => {
    const { authUser, socket } = get();

    if (!authUser || socket?.connected) return;

    // A socket left over from a previous session must not be reused.
    socket?.disconnect();

    const nextSocket = io(BASE_URL, {
      withCredentials: true, // sends the httpOnly auth cookie
    });

    nextSocket.on("getOnlineUsers", (userIds) => set({ onlineUsers: userIds }));

    set({ socket: nextSocket });
  },

  disconnectSocket: () => {
    const { socket } = get();
    socket?.disconnect();
    set({ socket: null, onlineUsers: [] });
  },
}));
