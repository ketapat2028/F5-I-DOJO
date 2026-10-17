// เชื่อมกับจอ Station ของ portal I-Dojo — สัญญาใน PORTAL_INTEGRATION.md (version 1)
// ห้ามเปลี่ยนรูปแบบข้อความเอง portal ตรวจ version: 1 ตรงตัว
const VERSION = 1;
export type PortalResult = "pass" | "fail";
export type PortalAck = { result: PortalResult; ok: boolean; message?: string };

export const isEmbedded = (): boolean => window.parent !== window;
let screenOrigin: string | null = null;

function send(msg: Record<string, unknown>) {
  if (!isEmbedded()) return;
  window.parent.postMessage({ version: VERSION, ...msg }, screenOrigin ?? "*");
}

// ฟัง activity-start / activity-ack — คืนฟังก์ชันยกเลิก (ใช้ใน useEffect)
export function listenPortal(
  onAck: (ack: PortalAck) => void,
  onStart?: (d: { stationNo: number | null; sessionId: number | null }) => void,
) {
  function onMessage(e: MessageEvent) {
    if (e.source !== window.parent || e.data?.version !== VERSION) return;
    if (e.data.type === "idojo:activity-start") {
      screenOrigin = e.origin;
      onStart?.(e.data);
    }
    if (e.data.type === "idojo:activity-ack") {
      onAck({ result: e.data.result, ok: Boolean(e.data.ok), message: e.data.message });
    }
  }
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

export function sendResult(result: PortalResult, score?: number) {
  send({ type: "idojo:activity-result", result, ...(Number.isInteger(score) ? { score } : {}) });
}

// ส่งต่อ Enter/Spacebar ของวิทยากรขึ้นไปที่จอ (ยกเว้นตอนพิมพ์ในช่องกรอก)
export function forwardKeys() {
  function onKey(e: KeyboardEvent) {
    if (!isEmbedded() || (e.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable='true']")) return;
    if (["Enter", "NumpadEnter", "Space"].includes(e.code)) {
      e.preventDefault();
      send({ type: "idojo:key", key: e.code === "Space" ? "Space" : "Enter" });
    }
  }
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
