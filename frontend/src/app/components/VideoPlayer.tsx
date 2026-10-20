import { cn } from "./ui/utils";

// ไม่รองรับ YouTube แล้ว (จอ Station ไม่มีเน็ตออก) — ใช้ตรวจข้อมูลเก่าที่ยังเป็นลิงก์ YouTube อยู่
export function isYouTubeUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url, window.location.href).hostname.replace(/^(www\.|m\.)/, "");
    return host === "youtu.be" || host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com");
  } catch {
    return false;
  }
}

export function VideoPlayer({ url, className }: { url: string; className?: string }) {
  return <video src={url} controls playsInline className={cn("aspect-video w-full bg-black", className)} />;
}
