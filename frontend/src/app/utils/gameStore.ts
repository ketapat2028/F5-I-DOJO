import type { MatchPair, PromptType, Theme } from "../types/theme";

// key เดิมตอนยังเก็บใน localStorage — เหลือไว้อ่านเพื่อย้ายข้อมูลขึ้น server เท่านั้น (readLegacyLocalGame)
export const PAIRS_KEY = "f1-dojo-pairs-v4-click-match";
const META_KEY = "idojo.f1.meta.v4";
const DEFAULT_NAME = "DOJO · F1 RACING RED";
const DEFAULT_TIME = 300;

// crypto.randomUUID ใช้ได้เฉพาะ secure context — เปิดผ่าน http://<IP ของ Pi> จะไม่มี
function genId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function makeEmptyPair(): MatchPair {
  return { id: genId(), promptType: "text", promptText: "", answerType: "text", answerText: "" };
}

// ===== รูปแบบข้อมูลสำหรับ Import/Export (ตามโครงสร้าง EDIT MODE) =====
interface SpecSide {
  type?: string;
  text?: string;
  imageUrl?: string;
}

export interface SpecRecord {
  id?: string;
  question?: SpecSide;
  answer?: SpecSide;
  videoUrl?: string;
  videoTitle?: string;
  videoDesc?: string;
}

function svg(markup: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 180'><rect width='320' height='180' fill='#161616'/>${markup}</svg>`,
  )}`;
}

const IMG_FERRARI_CAR = svg(
  "<rect y='128' width='320' height='52' fill='#2a2a2a'/>" +
    "<path d='M40 118 L70 98 L130 92 L170 78 L230 82 L262 100 L292 104 L292 122 L40 122 Z' fill='#DC0000'/>" +
    "<rect x='258' y='84' width='40' height='6' fill='#DC0000'/><rect x='30' y='96' width='22' height='5' fill='#DC0000'/>" +
    "<circle cx='96' cy='124' r='22' fill='#0a0a0a' stroke='#666' stroke-width='4'/>" +
    "<circle cx='236' cy='124' r='22' fill='#0a0a0a' stroke='#666' stroke-width='4'/>" +
    "<text x='160' y='42' font-family='Arial' font-weight='bold' font-size='28' fill='#FFD60A' text-anchor='middle'>SF-23</text>",
);
const IMG_FERRARI_LOGO = svg(
  "<path d='M105 22 H215 V92 Q215 140 160 160 Q105 140 105 92 Z' fill='#FFD60A' stroke='#fff' stroke-width='4'/>" +
    "<rect x='105' y='22' width='110' height='14' fill='#22C55E'/><rect x='105' y='36' width='110' height='8' fill='#fff'/><rect x='105' y='44' width='110' height='8' fill='#DC0000'/>" +
    "<text x='160' y='104' font-family='Arial' font-weight='bold' font-size='34' fill='#111' text-anchor='middle'>SF</text>" +
    "<text x='160' y='130' font-family='Arial' font-weight='bold' font-size='16' fill='#DC0000' text-anchor='middle'>FERRARI</text>",
);
const IMG_REDBULL = svg(
  "<rect x='40' y='34' width='240' height='112' rx='16' fill='#1E3A8A'/>" +
    "<circle cx='160' cy='78' r='28' fill='#FFD60A'/><path d='M96 78 h36 M188 78 h36' stroke='#DC0000' stroke-width='12'/>" +
    "<text x='160' y='128' font-family='Arial' font-weight='bold' font-size='18' fill='#fff' text-anchor='middle'>RED BULL RACING</text>",
);
const IMG_TROPHY = svg(
  "<path d='M115 38 H205 V82 Q205 118 160 124 Q115 118 115 82 Z' fill='#FFD60A'/>" +
    "<path d='M115 50 H92 Q92 86 118 92 M205 50 H228 Q228 86 202 92' fill='none' stroke='#FFD60A' stroke-width='8'/>" +
    "<rect x='150' y='124' width='20' height='26' fill='#FFD60A'/><rect x='126' y='150' width='68' height='12' fill='#FFD60A'/>" +
    "<text x='160' y='30' font-family='Arial' font-weight='bold' font-size='20' fill='#fff' text-anchor='middle'>2023</text>",
);

function seedPairs(): MatchPair[] {
  type TextSeed = [string, string, string, string, string];
  const textSeeds: TextSeed[] = [
    ["DRS", "ระบบลดแรงต้านอากาศ", "8h5d1v9T0eY", "DRS คืออะไร? ทำไมถึงแซงได้ง่าย", "การทำงานของ Drag Reduction System วิธีเปิดใช้ และจุดตรวจจับบนแทร็ก"],
    ["ERS", "ระบบคืนพลังงานไฟฟ้า", "0h0X8q1j3wQ", "ERS ระบบไฮบริดหัวใจของ F1", "เจาะลึก MGU-K และ MGU-H วิธีเก็บและปล่อยพลังงาน 160 แรงม้า"],
    ["Undercut", "กลยุทธ์เข้าพิตก่อนเพื่อแซง", "dQw4w9WgXcQ", "Undercut vs Overcut วางแผนยังไงให้ชนะ", "กลยุทธ์พิตสต็อปที่ Ferrari และ Red Bull ใช้บ่อยที่สุด"],
    ["Pole Position", "ออกตัวอันดับ 1 จากควอลิฟาย", "jNQXAC9IVRw", "ทำไม Pole ถึงสำคัญที่โมนาโก", "สถิติการชนะจากโพล และเทคนิคทำเวลาต่อรอบ"],
    ["Safety Car", "รถนำขบวนช่วงอุบัติเหตุ", "9bZkp7q19f0", "Safety Car เปลี่ยนเกมการแข่งขันยังไง", "กฎ Safety Car และ Virtual Safety Car"],
    ["DRS Zone", "โซนที่อนุญาตให้เปิด DRS", "3JZ_D3ELwOQ", "อ่าน DRS Detection Point ให้เป็น", "ดูกราฟิกบนจอให้รู้ว่ารถคันไหนเปิด DRS ได้"],
  ];
  const pairs: MatchPair[] = textSeeds.map(([q, a, vid, title, desc], i) => ({
    id: `p${i + 1}`,
    promptType: "text",
    promptText: q,
    answerType: "text",
    answerText: a,
    videoUrl: `https://www.youtube.com/embed/${vid}`,
    videoTitle: title,
    videoDesc: desc,
  }));
  pairs.push(
    {
      id: "p7",
      promptType: "image",
      promptText: "Ferrari SF-23",
      promptImage: IMG_FERRARI_CAR,
      answerType: "image",
      answerText: "Ferrari",
      answerImage: IMG_FERRARI_LOGO,
      videoUrl: "https://www.youtube.com/embed/8h5d1v9T0eY",
      videoTitle: "จับคู่ภาพ: รถแข่ง → ทีมผู้ผลิต",
      videoDesc: "ตัวอย่างโหมดจับคู่ภาพ",
    },
    {
      id: "p8",
      promptType: "mixed",
      promptText: "ทีมแชมป์โลก 2023 คือ?",
      promptImage: IMG_TROPHY,
      answerType: "image",
      answerText: "Red Bull Racing",
      answerImage: IMG_REDBULL,
      videoUrl: "https://www.youtube.com/embed/0h0X8q1j3wQ",
      videoTitle: "Mixed Mode: ภาพ + ข้อความ → ภาพ",
      videoDesc: "โจทย์มีภาพและข้อความ คำตอบเป็นภาพ",
    },
  );
  return pairs;
}

export function toSpecRecord(pair: MatchPair): SpecRecord {
  return {
    id: pair.id,
    question: { type: pair.promptType, text: pair.promptText, imageUrl: pair.promptImage ?? "" },
    answer: { type: pair.answerType, text: pair.answerText, imageUrl: pair.answerImage ?? "" },
    videoUrl: pair.videoUrl ?? "",
    videoTitle: pair.videoTitle ?? "",
    videoDesc: pair.videoDesc ?? "",
  };
}

function normalizeType(value: unknown): PromptType {
  return value === "image" || value === "mixed" ? value : "text";
}

function optString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// รองรับทั้งรูปแบบใหม่ (question/answer เป็น object) และรูปแบบเก่า (topic/answer เป็นข้อความ)
function fromAnyRecord(record: Record<string, unknown>): MatchPair {
  const q = isObject(record.question) ? record.question : undefined;
  const a = isObject(record.answer) ? record.answer : undefined;
  return {
    id: typeof record.id === "string" || typeof record.id === "number" ? String(record.id) : genId(),
    promptType: normalizeType(q ? q.type : (record.type ?? record.promptType)),
    promptText: String((q ? q.text : (record.topic ?? record.promptText)) ?? ""),
    promptImage: optString(q ? q.imageUrl : (record.imageUrl ?? record.promptImage)),
    answerType: normalizeType(a ? a.type : record.answerType),
    answerText: String((a ? a.text : (typeof record.answer === "string" ? record.answer : record.answerText)) ?? ""),
    answerImage: optString(a ? a.imageUrl : record.answerImage),
    videoUrl: optString(record.videoUrl),
    videoTitle: optString(record.videoTitle),
    videoDesc: optString(record.videoDesc),
  };
}

function recordsToPairs(data: unknown): MatchPair[] {
  const list: unknown[] = Array.isArray(data)
    ? data
    : isObject(data) && Array.isArray(data.pairs)
      ? data.pairs
      : [];
  const pairs = list.filter(isObject).map(fromAnyRecord);
  // id ซ้ำจะทำให้การ์ดชนกัน จึงสร้าง id ใหม่ให้ตัวที่ซ้ำ
  const seen = new Set<string>();
  return pairs.map((p) => {
    if (seen.has(p.id)) return { ...p, id: genId() };
    seen.add(p.id);
    return p;
  });
}

// ===== ชุดคำถามเก็บที่ backend (/api/game) =====
// เกมถูกฝังเป็น iframe ข้ามเว็บบนจอ Station — Chromium แยก localStorage ของ iframe จึงต้องอ่านจาก API เท่านั้น
const API = `${import.meta.env.BASE_URL}api`;

export class NoGameError extends Error {
  constructor() {
    super("ยังไม่มีชุดคำถามบน server");
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super("รหัสผู้ดูแลไม่ถูกต้อง");
  }
}

function toPayload(game: Theme) {
  return { name: game.name, timeLimitSeconds: game.timeLimitSeconds, pairs: game.pairs.map(toSpecRecord) };
}

function fromPayload(data: unknown): Theme {
  const m = isObject(data) ? data : {};
  return {
    id: "f1-board",
    name: typeof m.name === "string" && m.name ? m.name : DEFAULT_NAME,
    timeLimitSeconds: Number.isFinite(m.timeLimitSeconds) ? Math.max(0, m.timeLimitSeconds as number) : DEFAULT_TIME,
    pairs: recordsToPairs(data),
    createdAt: 0,
    updatedAt: 0,
  };
}

async function failure(res: Response, what: string): Promise<Error> {
  if (res.status === 401) return new UnauthorizedError();
  let detail = "";
  try {
    const body = await res.json();
    if (typeof body?.error === "string") detail = `: ${body.error}`;
  } catch {
    // ไม่มี body เป็น JSON
  }
  return new Error(`${what}ไม่สำเร็จ (${res.status})${detail}`);
}

export async function getGame(): Promise<Theme> {
  const res = await fetch(`${API}/game`, { cache: "no-store" });
  if (res.status === 404) throw new NoGameError();
  if (!res.ok) throw await failure(res, "โหลดชุดคำถาม");
  const game = fromPayload(await res.json());
  if (game.pairs.length < 2) throw new NoGameError();
  return game;
}

export async function saveGame(game: Theme, adminSecret: string): Promise<Theme> {
  const res = await fetch(`${API}/game`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-admin-secret": adminSecret },
    body: JSON.stringify(toPayload(game)),
  });
  if (!res.ok) throw await failure(res, "บันทึก");
  return { ...game, updatedAt: Date.now() };
}

export async function verifyAdmin(adminSecret: string): Promise<boolean> {
  const res = await fetch(`${API}/admin/check`, { headers: { "x-admin-secret": adminSecret } });
  if (res.status === 401) return false;
  if (!res.ok) throw await failure(res, "ตรวจรหัส");
  return true;
}

// คืน URL ของรูปบน server (/I-DOJO/api/uploads/<file>) ไว้เก็บแทน base64
export async function uploadImage(file: Blob, adminSecret: string): Promise<string> {
  const form = new FormData();
  const name = file instanceof File ? file.name : "image.jpg";
  form.append("image", file, name);
  const res = await fetch(`${API}/upload`, {
    method: "POST",
    headers: { "x-admin-secret": adminSecret },
    body: form,
  });
  if (!res.ok) throw await failure(res, "อัปโหลดรูป");
  const { filename } = await res.json();
  return `${API}/uploads/${filename}`;
}

// ชุดตัวอย่าง F1 ให้ editor ใช้เป็นจุดเริ่มเมื่อ server ยังไม่มีข้อมูล
export function makeDemoGame(): Theme {
  return { ...fromPayload({}), pairs: seedPairs() };
}

// ข้อมูลเดิมที่เคยเก็บใน localStorage ของ browser นี้ (ก่อนย้ายไป backend) — ใช้ย้ายขึ้น server ครั้งเดียว
export function readLegacyLocalGame(): Theme | null {
  try {
    const raw = localStorage.getItem(PAIRS_KEY);
    if (!raw) return null;
    const pairs = recordsToPairs(JSON.parse(raw));
    if (pairs.length < 2) return null;
    const meta = JSON.parse(localStorage.getItem(META_KEY) ?? "{}");
    return { ...fromPayload(meta), pairs };
  } catch {
    return null;
  }
}

export function exportGameJson(game: Theme): string {
  return JSON.stringify(toPayload(game), null, 2);
}

function sideComplete(type: PromptType, text: string, image?: string): boolean {
  if (type === "text") return Boolean(text.trim());
  if (type === "image") return Boolean(image);
  return Boolean(text.trim()) && Boolean(image);
}

export function isPairComplete(p: MatchPair): boolean {
  return sideComplete(p.promptType, p.promptText, p.promptImage) && sideComplete(p.answerType, p.answerText, p.answerImage);
}

export function parseImportedPairs(raw: string): MatchPair[] {
  const pairs = recordsToPairs(JSON.parse(raw)).filter(isPairComplete);
  if (pairs.length < 2) {
    throw new Error("ไฟล์ต้องมีอย่างน้อย 2 คู่ และแต่ละคู่ต้องมีคำถามกับคำตอบครบ");
  }
  return pairs;
}
