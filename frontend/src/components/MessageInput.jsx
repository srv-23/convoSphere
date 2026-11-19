import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { ImageIcon, SendIcon, XIcon } from "lucide-react";

import useKeyboardSound from "../hooks/useKeyboardSound";
import { useTypingIndicator } from "../hooks/useTypingIndicator";
import { useChatStore } from "../store/useChatStore";
import { downscaleImage } from "../lib/image";

function MessageInput() {
  const { playRandomKeyStrokeSound } = useKeyboardSound();
  const [text, setText] = useState("");
  const [imagePreview, setImagePreview] = useState(null);
  const [isPreparingImage, setIsPreparingImage] = useState(false);

  const fileInputRef = useRef(null);

  const { sendMessage, isSoundEnabled, selectedUser } = useChatStore();
  const onType = useTypingIndicator(selectedUser?._id);

  const handleSendMessage = async (event) => {
    event.preventDefault();

    const trimmed = text.trim();
    if ((!trimmed && !imagePreview) || isPreparingImage) return;

    if (isSoundEnabled) playRandomKeyStrokeSound();

    const payload = { text: trimmed || undefined, image: imagePreview || undefined };

    setText("");
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";

    await sendMessage(payload);
  };

  const handleImageChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsPreparingImage(true);
    try {
      // Compress in the browser: a 6 MB phone photo becomes ~200 KB, which
      // keeps the request well under the API body limit.
      const dataUrl = await downscaleImage(file);
      setImagePreview(dataUrl);
    } catch (error) {
      toast.error(error.message ?? "Could not process that image");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setIsPreparingImage(false);
    }
  };

  const removeImage = () => {
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="p-4 border-t border-slate-700/50">
      {imagePreview && (
        <div className="max-w-3xl mx-auto mb-3 flex items-center">
          <div className="relative">
            <img
              src={imagePreview}
              alt="Attachment preview"
              className="w-20 h-20 object-cover rounded-lg border border-slate-700"
            />
            <button
              onClick={removeImage}
              className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-slate-200 hover:bg-slate-700"
              type="button"
              aria-label="Remove attachment"
            >
              <XIcon className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSendMessage} className="max-w-3xl mx-auto flex space-x-4">
        <input
          type="text"
          value={text}
          maxLength={2000}
          onChange={(event) => {
            setText(event.target.value);
            if (isSoundEnabled) playRandomKeyStrokeSound();
            onType();
          }}
          className="flex-1 bg-slate-800/50 border border-slate-700/50 rounded-lg py-2 px-4"
          placeholder="Type your message..."
        />

        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          onChange={handleImageChange}
          className="hidden"
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isPreparingImage}
          aria-label="Attach an image"
          className={`bg-slate-800/50 text-slate-400 hover:text-slate-200 rounded-lg px-4 transition-colors disabled:opacity-50 ${
            imagePreview ? "text-cyan-500" : ""
          }`}
        >
          <ImageIcon className={`w-5 h-5 ${isPreparingImage ? "animate-pulse" : ""}`} />
        </button>

        <button
          type="submit"
          disabled={(!text.trim() && !imagePreview) || isPreparingImage}
          aria-label="Send message"
          className="bg-gradient-to-r from-cyan-500 to-cyan-600 text-white rounded-lg px-4 py-2 font-medium hover:from-cyan-600 hover:to-cyan-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <SendIcon className="w-5 h-5" />
        </button>
      </form>
    </div>
  );
}

export default MessageInput;
