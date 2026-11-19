import { useCallback, useEffect, useRef } from "react";
import { useAuthStore } from "../store/useAuthStore";

const TYPING_THROTTLE_MS = 1500;
const TYPING_IDLE_MS = 2000;

/**
 * Emits `typing` events while the user types, and a `typing: false` event
 * once they stop. Throttled so a 60 wpm typist does not emit 300 events per
 * sentence, and cleared on unmount so the peer never gets stuck on
 * "typing...".
 */
export function useTypingIndicator(receiverId) {
  const socket = useAuthStore((state) => state.socket);
  const lastSentAt = useRef(0);
  const idleTimer = useRef(null);
  const isTyping = useRef(false);

  const stop = useCallback(() => {
    clearTimeout(idleTimer.current);
    idleTimer.current = null;

    if (isTyping.current && socket && receiverId) {
      socket.emit("typing", { receiverId, isTyping: false });
    }
    isTyping.current = false;
    lastSentAt.current = 0;
  }, [socket, receiverId]);

  const onType = useCallback(() => {
    if (!socket || !receiverId) return;

    const now = Date.now();
    if (now - lastSentAt.current > TYPING_THROTTLE_MS || !isTyping.current) {
      socket.emit("typing", { receiverId, isTyping: true });
      lastSentAt.current = now;
      isTyping.current = true;
    }

    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(stop, TYPING_IDLE_MS);
  }, [socket, receiverId, stop]);

  // Leaving the conversation must not leave the peer on "typing...".
  useEffect(() => stop, [stop]);

  return onType;
}
