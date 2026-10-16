// แปลงไฟล์รูปเป็น data URL (base64) เพื่อเก็บลง localStorage โดยตรง
// ไฟล์ใหญ่จะถูกย่อขนาดลงก่อน เพื่อไม่ให้ localStorage เต็มเร็วเกินไป
const MAX_WIDTH = 900;
const SKIP_RESIZE_BELOW_BYTES = 150 * 1024;

export async function fileToImageDataUrl(file: File): Promise<string> {
  if (file.size < SKIP_RESIZE_BELOW_BYTES) {
    return readAsDataUrl(file);
  }
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  if (img.width <= MAX_WIDTH) {
    return original;
  }
  const scale = MAX_WIDTH / img.width;
  const canvas = document.createElement("canvas");
  canvas.width = MAX_WIDTH;
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return original;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
