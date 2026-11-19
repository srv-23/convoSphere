import { ENV } from "./env.js";

const DATA_URL_PATTERN = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i;

/**
 * Approximate decoded size of a base64 data URL, without allocating a Buffer.
 * 4 base64 characters encode 3 bytes.
 */
export function base64Bytes(dataUrl) {
  if (typeof dataUrl !== "string") return 0;
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex === -1) return 0;

  const payload = dataUrl.slice(commaIndex + 1).replace(/=+$/, "");
  return Math.floor((payload.length * 3) / 4);
}

export function isDataImage(value) {
  return typeof value === "string" && DATA_URL_PATTERN.test(value);
}

/**
 * Validate an incoming image payload before it reaches Cloudinary.
 * @returns {{ ok: true, bytes: number } | { ok: false, message: string }}
 */
export function validateImagePayload(value, { maxBytes = ENV.MAX_IMAGE_BYTES } = {}) {
  if (!isDataImage(value)) {
    return { ok: false, message: "Image must be a base64 data URL (png, jpg, webp or gif)" };
  }

  const bytes = base64Bytes(value);
  if (bytes === 0) {
    return { ok: false, message: "Image payload is empty" };
  }
  if (bytes > maxBytes) {
    const mb = (maxBytes / (1024 * 1024)).toFixed(1);
    return { ok: false, message: `Image is too large (max ${mb} MB after compression)` };
  }

  return { ok: true, bytes };
}

export const IMAGE_FOLDERS = {
  avatar: "convosphere/avatars",
  message: "convosphere/messages",
};

export const IMAGE_TRANSFORMS = {
  avatar: [{ width: 512, height: 512, crop: "fill", gravity: "face" }],
  message: [{ width: 1280, crop: "limit", quality: "auto", fetch_format: "auto" }],
};
