import { cn } from "./ui/utils";

// แปลงลิงก์ watch / youtu.be / shorts ให้เป็นลิงก์ embed เพราะ YouTube ไม่อนุญาตให้ฝังลิงก์ watch ตรงๆ
export function toEmbedUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = u.pathname.slice(1);
      return id ? `https://www.youtube.com/embed/${id}` : url;
    }
    if (host.endsWith("youtube.com")) {
      if (u.pathname === "/watch") {
        const id = u.searchParams.get("v");
        return id ? `https://www.youtube.com/embed/${id}` : url;
      }
      const shorts = u.pathname.match(/^\/shorts\/([^/]+)/);
      if (shorts) return `https://www.youtube.com/embed/${shorts[1]}`;
    }
  } catch {
    // ไม่ใช่ URL ที่แปลงได้ ใช้ค่าเดิม
  }
  return url;
}

export function VideoPlayer({ url, className }: { url: string; className?: string }) {
  const src = toEmbedUrl(url);
  if (src.includes("youtube.com")) {
    return (
      <iframe
        src={src}
        title="video"
        className={cn("aspect-video w-full", className)}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }
  return <video src={src} controls className={cn("aspect-video w-full bg-black", className)} />;
}
