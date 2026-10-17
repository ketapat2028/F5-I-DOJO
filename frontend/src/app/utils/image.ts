// ย่อรูปก่อนอัปโหลดขึ้น server (กว้างสุด 900px) ไฟล์เล็กหรือแคบอยู่แล้วส่งไฟล์เดิม
const MAX_WIDTH = 900;
const SKIP_RESIZE_BELOW_BYTES = 150 * 1024;

export async function fileToUploadableImage(file: File): Promise<Blob> {
  if (file.size < SKIP_RESIZE_BELOW_BYTES) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    if (img.width <= MAX_WIDTH) return file;
    const scale = MAX_WIDTH / img.width;
    const canvas = document.createElement("canvas");
    canvas.width = MAX_WIDTH;
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
