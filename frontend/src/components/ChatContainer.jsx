import { useEffect, useRef } from "react";
import { Check, CheckCheck, LoaderIcon } from "lucide-react";
import { useAuthStore } from "../store/useAuthStore";
import { useChatStore } from "../store/useChatStore";
import ChatHeader from "./ChatHeader";
import NoChatHistoryPlaceholder from "./NoChatHistoryPlaceholder";
import MessageInput from "./MessageInput";
import MessagesLoadingSkeleton from "./MessagesLoadingSkeleton";

const formatTime = (value) =>
  new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const DeliveryStatus = ({ status, isOptimistic }) => {
  if (isOptimistic || status === "sent") {
    return <Check className="size-3.5 opacity-70" aria-label="Sent" />;
  }
  if (status === "delivered") {
    return <CheckCheck className="size-3.5 opacity-70" aria-label="Delivered" />;
  }
  return <CheckCheck className="size-3.5 text-cyan-300" aria-label="Read" />;
};

function ChatContainer() {
  const {
    selectedUser,
    getMessagesByUserId,
    messages,
    isMessagesLoading,
    hasMore,
    isFetchingOlder,
    loadOlderMessages,
  } = useChatStore();
  const { authUser } = useAuthStore();
  const messageEndRef = useRef(null);

  useEffect(() => {
    if (selectedUser?._id) getMessagesByUserId(selectedUser._id);
  }, [selectedUser?._id, getMessagesByUserId]);

  // Only follow the newest message. Prepending an older page must not yank
  // the viewport back to the bottom.
  const newestId = messages[messages.length - 1]?._id;

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [newestId]);

  return (
    <>
      <ChatHeader />
      <div className="flex-1 px-6 overflow-y-auto py-8">
        {messages.length > 0 && !isMessagesLoading ? (
          <div className="max-w-3xl mx-auto space-y-6">
            {hasMore && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={loadOlderMessages}
                  disabled={isFetchingOlder}
                  className="px-4 py-1.5 text-xs text-cyan-300 bg-cyan-500/10 rounded-full hover:bg-cyan-500/20 disabled:opacity-60 flex items-center gap-2"
                >
                  {isFetchingOlder && <LoaderIcon className="size-3 animate-spin" />}
                  {isFetchingOlder ? "Loading" : "Load earlier messages"}
                </button>
              </div>
            )}

            {messages.map((msg) => {
              const isMine = String(msg.senderId) === String(authUser._id);

              return (
                <div key={msg._id} className={`chat ${isMine ? "chat-end" : "chat-start"}`}>
                  <div
                    className={`chat-bubble relative ${
                      isMine ? "bg-cyan-600 text-white" : "bg-slate-800 text-slate-200"
                    } ${msg.isOptimistic ? "opacity-70" : ""}`}
                  >
                    {msg.image && (
                      <img
                        src={msg.image}
                        alt="Shared attachment"
                        loading="lazy"
                        className="rounded-lg max-h-64 w-auto object-cover"
                      />
                    )}
                    {msg.text && <p className="mt-2 whitespace-pre-wrap break-words">{msg.text}</p>}
                    <p className="text-xs mt-1 opacity-75 flex items-center gap-1 justify-end">
                      {formatTime(msg.createdAt)}
                      {isMine && (
                        <DeliveryStatus status={msg.status} isOptimistic={msg.isOptimistic} />
                      )}
                    </p>
                  </div>
                </div>
              );
            })}
            <div ref={messageEndRef} />
          </div>
        ) : isMessagesLoading ? (
          <MessagesLoadingSkeleton />
        ) : (
          <NoChatHistoryPlaceholder name={selectedUser.fullName} />
        )}
      </div>

      <MessageInput />
    </>
  );
}

export default ChatContainer;
