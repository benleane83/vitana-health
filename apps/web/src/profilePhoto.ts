const supportedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maximumSourceBytes = 10 * 1024 * 1024;

export interface SquareCrop {
  sourceX: number;
  sourceY: number;
  sourceSize: number;
}

export function centeredSquareCrop(width: number, height: number): SquareCrop {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Image dimensions are invalid.");
  }
  const sourceSize = Math.min(width, height);
  return {
    sourceX: (width - sourceSize) / 2,
    sourceY: (height - sourceSize) / 2,
    sourceSize
  };
}

export async function normalizeProfilePhoto(file: File): Promise<string> {
  if (!supportedTypes.has(file.type)) throw new Error("Choose a JPEG, PNG, or WebP image.");
  if (file.size === 0) throw new Error("The selected image is empty.");
  if (file.size > maximumSourceBytes) throw new Error("Choose an image smaller than 10 MB.");

  const image = await decodeImage(file);
  try {
    const crop = centeredSquareCrop(image.width, image.height);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is unavailable.");
    context.drawImage(
      image.source,
      crop.sourceX,
      crop.sourceY,
      crop.sourceSize,
      crop.sourceSize,
      0,
      0,
      256,
      256
    );
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not encode the selected image.")), "image/jpeg", 0.85)
    );
    return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
  } finally {
    image.close();
  }
}

async function decodeImage(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  close(): void;
}> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const candidate = new Image();
      candidate.onload = () => resolve(candidate);
      candidate.onerror = () => reject(new Error("The selected image is corrupt or unsupported."));
      candidate.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url)
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
