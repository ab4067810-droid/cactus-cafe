const MAX_RECEIPT_FILE_SIZE = 12 * 1024 * 1024;
const MAX_COMPRESSED_RECEIPT_SIZE = 240 * 1024;

export const compressReceiptImage = async (file) => {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP receipt image.");
  }
  if (file.size > MAX_RECEIPT_FILE_SIZE) {
    throw new Error("Receipt image must be 12 MB or smaller.");
  }

  const imageUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = imageUrl;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("Unable to read this receipt image."));
    });

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Receipt image compression is unavailable in this browser.");
    }
    let maxDimension = Math.min(
      1280,
      Math.max(image.naturalWidth, image.naturalHeight),
    );
    let quality = 0.78;
    let blob = null;
    while (true) {
      const scale = maxDimension / Math.max(
        image.naturalWidth,
        image.naturalHeight,
      );
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      blob = await new Promise((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", quality);
      });
      if (!blob) {
        throw new Error("Unable to compress this receipt image.");
      }
      if (blob.size <= MAX_COMPRESSED_RECEIPT_SIZE) break;
      if (quality > 0.48) {
        quality -= 0.12;
      } else if (maxDimension > 480) {
        maxDimension = Math.max(480, Math.round(maxDimension * 0.8));
        quality = 0.72;
      } else {
        throw new Error(
          "Receipt image is too large to upload. Choose a smaller image.",
        );
      }
    }

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Unable to prepare this receipt image."));
      reader.readAsDataURL(blob);
    });
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
};
