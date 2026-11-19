import { create } from "zustand";
import toast from "react-hot-toast";

import { axiosInstance } from "../lib/axios";
import { useAuthStore } from "./useAuthStore";
import {
  addOptimistic,
  applyReadReceipt,
  bumpChat,
  dropOptimistic,
  isOptimistic,
  markChatRead,
  prependOlder,
  reconcileOptimistic,
  upsertMessage,
} from "./messageState";

const PAGE_SIZE = 30;
const TYPING_SAFETY_TIMEOUT_MS = 4000;

const readSoundPreference = () => {
  try {
    return JSON.parse(localStorage.getItem("isSoundEnabled")) === true;
  } catch {
    return false;
  }
};

const playNotification = () => {
  const sound = new Audio("/sounds/notification.mp3");
  sound.play().catch(() => {
    /* autoplay can be blocked until the user interacts */
  });
};

const baseState = {
  allContacts: [],
  chats: [],
  messages: [],
  hasMore: false,
  activeTab: "chats",
  selectedUser: null,
  isUsersLoading: false,
  isMessagesLoading: false,
  isFetchingOlder: false,
  typingUsers: {},
};

export const useChatStore = create((set, get) => ({
  ...baseState,
  isSoundEnabled: readSoundPreference(),

  toggleSound: () => {
    const next = !get().isSoundEnabled;
    localStorage.setItem("isSoundEnabled", JSON.stringify(next));
    set({ isSoundEnabled: next });
  },

  setActiveTab: (activeTab) => set({ activeTab }),

  setSelectedUser: (selectedUser) =>
    // Clear the previous thread immediately: rendering the old messages while
    // the new ones load is a visible data mix-up.
    set({ selectedUser, messages: [], hasMore: false }),

  /** Called on logout so one user's data never survives into the next session. */
  reset: () => {
    get().unbindSocketEvents?.();
    set({ ...baseState, isSoundEnabled: get().isSoundEnabled });
  },

  getAllContacts: async () => {
    set({ isUsersLoading: true });
    try {
      const res = await axiosInstance.get("/messages/contacts");
      set({ allContacts: res.data });
    } catch (error) {
      toast.error(error.response?.data?.message ?? "Could not load contacts");
    } finally {
      set({ isUsersLoading: false });
    }
  },

  getMyChatPartners: async () => {
    set({ isUsersLoading: true });
    try {
      const res = await axiosInstance.get("/messages/chats");
      set({ chats: res.data });
    } catch (error) {
      toast.error(error.response?.data?.message ?? "Could not load chats");
    } finally {
      set({ isUsersLoading: false });
    }
  },

  getMessagesByUserId: async (userId) => {
    set({ isMessagesLoading: true, messages: [], hasMore: false });
    try {
      const res = await axiosInstance.get(`/messages/${userId}?limit=${PAGE_SIZE}`);
      set({ messages: res.data.messages, hasMore: res.data.hasMore });
      get().markConversationRead(userId);
    } catch (error) {
      toast.error(error.response?.data?.message ?? "Could not load messages");
    } finally {
      set({ isMessagesLoading: false });
    }
  },

  loadOlderMessages: async () => {
    const { messages, selectedUser, hasMore, isFetchingOlder } = get();
    if (!selectedUser || !hasMore || isFetchingOlder) return;

    const oldest = messages.find((message) => !isOptimistic(message));
    if (!oldest) return;

    set({ isFetchingOlder: true });
    try {
      const before = encodeURIComponent(oldest.createdAt);
      const res = await axiosInstance.get(
        `/messages/${selectedUser._id}?limit=${PAGE_SIZE}&before=${before}`
      );
      // Merge into the *current* list, not the snapshot taken above.
      set({
        messages: prependOlder(res.data.messages, get().messages),
        hasMore: res.data.hasMore,
      });
    } catch (error) {
      toast.error(error.response?.data?.message ?? "Could not load older messages");
    } finally {
      set({ isFetchingOlder: false });
    }
  },

  markConversationRead: async (userId) => {
    if (!userId) return;
    try {
      const res = await axiosInstance.put(`/messages/${userId}/read`);
      set({ chats: markChatRead(get().chats, userId) });
      if (res.data?.updated > 0) {
        set({ messages: applyReadReceipt(get().messages, userId) });
      }
    } catch {
      // Read receipts are best-effort; never interrupt the chat for them.
    }
  },

  sendMessage: async (messageData) => {
    const { selectedUser } = get();
    const { authUser } = useAuthStore.getState();

    if (!selectedUser || !authUser) return;

    const conversationId = selectedUser._id;
    const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimisticMessage = {
      _id: `temp-${tempId}`,
      senderId: authUser._id,
      receiverId: conversationId,
      text: messageData.text,
      image: messageData.image,
      status: "sent",
      createdAt: new Date().toISOString(),
      isOptimistic: true,
    };

    set({
      messages: addOptimistic(get().messages, optimisticMessage),
      chats: bumpChat(get().chats, optimisticMessage, authUser._id),
    });

    try {
      const res = await axiosInstance.post(`/messages/send/${conversationId}`, messageData);

      // Only touch this thread if the user is still looking at it. Reading
      // get().messages at write time is what makes concurrent sends and
      // socket arrivals safe.
      if (String(get().selectedUser?._id) === String(conversationId)) {
        set({ messages: reconcileOptimistic(get().messages, optimisticMessage._id, res.data) });
      }
      set({ chats: bumpChat(get().chats, res.data, authUser._id) });
    } catch (error) {
      if (String(get().selectedUser?._id) === String(conversationId)) {
        set({ messages: dropOptimistic(get().messages, optimisticMessage._id) });
      }
      toast.error(error.response?.data?.message ?? "Message failed to send");
    }
  },

  /**
   * Bind socket listeners once, for every conversation. Handling events
   * globally (instead of re-subscribing per chat) means background messages
   * update the chat list, which is what an unread badge needs.
   * @returns {() => void} cleanup
   */
  bindSocketEvents: (socket) => {
    if (!socket) return () => {};

    const typingTimers = new Map();

    const onNewMessage = (message) => {
      const { authUser } = useAuthStore.getState();
      if (!authUser) return;

      const fromMe = String(message.senderId) === String(authUser._id);
      const partnerId = fromMe ? message.receiverId : message.senderId;
      const { chats, selectedUser, isSoundEnabled } = get();

      const knownChat = chats.some((chat) => String(chat._id) === String(partnerId));
      if (knownChat) {
        set({ chats: bumpChat(chats, message, authUser._id) });
      } else if (!fromMe) {
        // Someone started a new conversation with us.
        get().getMyChatPartners();
      }

      const inOpenThread =
        selectedUser && String(partnerId) === String(selectedUser._id);

      if (inOpenThread || fromMe) {
        set({ messages: upsertMessage(get().messages, message) });
      }

      if (fromMe) return;

      if (inOpenThread) {
        get().markConversationRead(partnerId);
        if (isSoundEnabled) playNotification();
      } else if (isSoundEnabled) {
        playNotification();
      }
    };

    const onTyping = ({ senderId, isTyping }) => {
      if (!senderId) return;

      set((state) => ({ typingUsers: { ...state.typingUsers, [senderId]: isTyping } }));

      clearTimeout(typingTimers.get(senderId));
      if (isTyping) {
        // Safety net: a dropped "stop" event must not pin "typing..." forever.
        typingTimers.set(
          senderId,
          setTimeout(() => {
            set((state) => ({ typingUsers: { ...state.typingUsers, [senderId]: false } }));
            typingTimers.delete(senderId);
          }, TYPING_SAFETY_TIMEOUT_MS)
        );
      } else {
        typingTimers.delete(senderId);
      }
    };

    const onMessagesRead = ({ by }) => {
      if (!by) return;
      set({ messages: applyReadReceipt(get().messages, by) });
    };

    socket.on("newMessage", onNewMessage);
    socket.on("typing", onTyping);
    socket.on("messagesRead", onMessagesRead);

    const cleanup = () => {
      for (const timer of typingTimers.values()) clearTimeout(timer);
      typingTimers.clear();
      socket.off("newMessage", onNewMessage);
      socket.off("typing", onTyping);
      socket.off("messagesRead", onMessagesRead);
    };

    set({ unbindSocketEvents: cleanup });
    return cleanup;
  },

  unbindSocketEvents: () => {},
}));
