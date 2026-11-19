// Client-side image preparation.
//
// The API accepts base64 data URLs, so a 6 MB phone photo becomes an ~8 MB
// request body and is rejected by the body limit. Downscaling in the browser
// keeps uploads small and fast, and gives the user a useful error instead of
// a generic failure.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const DEFAULT_MAX_DIMENSION = 1280;

/** Approximate decoded byte size of a base64 data URL. */
export function base64Bytes(dataUrl) {
  if (typeof dataUrl !== "string") return 0;
  const comma = dataUrl.indexOf(",");
  if (comma === -1) return 0;
  const payload = dataUrl.slice(comma + 1).replace(/=+$/, "");
  return Math.floor((payload.length * 3) / 4);
}

/**
 * Scale a box down so its longest side fits `max`, preserving aspect ratio.
 * Pure function so the sizing rule can be tested without a DOM.
 */
export function fitWithin(width, height, max = DEFAULT_MAX_DIMENSION) {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));

  if (safeWidth <= max && safeHeight <= max) {
    return { width: safeWidth, height: safeHeight };
  }

  const scale = max / Math.max(safeWidth, safeHeight);
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the selected file"));
    reader.readAsDataURL(file);
  });
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(file);
  }

  const dataUrl = await readAsDataUrl(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode the selected image"));
    image.src = dataUrl;
  });
}

function draw(bitmap, width, height, quality) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  context.drawImage(bitmap, 0, 0, width, height);

  return canvas.toDataURL("image/jpeg", quality);
}

/**
 * Convert a File into a compressed JPEG data URL.
 * @returns {Promise<string>} base64 data URL
 */
export async function downscaleImage(
  file,
  { maxDimension = DEFAULT_MAX_DIMENSION, quality = 0.8, maxBytes = MAX_IMAGE_BYTES } = {}
) {
  if (!file) throw new Error("Please select an image file");
  if (!file.type?.startsWith("image/")) throw new Error("Please select an image file");

  // Re-encoding a GIF through a canvas would freeze the animation.
  if (file.type === "image/gif") {
    const dataUrl = await readAsDataUrl(file);
    if (base64Bytes(dataUrl) > maxBytes) {
      throw new Error("GIF is too large. Please choose a smaller file.");
    }
    return dataUrl;
  }

  const bitmap = await loadBitmap(file);

  try {
    let size = fitWithin(bitmap.width, bitmap.height, maxDimension);
    let dataUrl = draw(bitmap, size.width, size.height, quality);

    if (base64Bytes(dataUrl) > maxBytes) {
      size = fitWithin(bitmap.width, bitmap.height, Math.floor(maxDimension / 2));
      dataUrl = draw(bitmap, size.width, size.height, 0.7);
    }

    if (base64Bytes(dataUrl) > maxBytes) {
      throw new Error("Image is too large even after compression. Please choose a smaller one.");
    }

    return dataUrl;
  } finally {
    bitmap.close?.();
  }
}
