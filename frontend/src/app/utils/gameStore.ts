import type { MatchPair, PromptType, Theme } from "../types/theme";

// pairs ทั้งหมด (รวมภาพและ videoUrl) เก็บที่ key นี้ ส่วนชื่อเกม/เวลาจำกัดแยกไว้อีก key
// ทุกฟังก์ชันคืน Promise ไว้แล้ว เพื่อสลับไปเรียก backend API จริงภายหลังได้โดยไม่ต้องแก้หน้าจอ
export const PAIRS_KEY = "f1-dojo-pairs-v4-click-match";
const META_KEY = "idojo.f1.meta.v4";
const DEFAULT_NAME = "DOJO · F1 RACING RED";
const DEFAULT_TIME = 300;

function genId(): string {
  return crypto.randomUUID();
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

function svg(markup: string, width = 320): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${width} 180'>${markup}</svg>`,
  )}`;
}

const IMG_FERRARI_CAR = svg(
  "<defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#f4f4f5'/><stop offset='1' stop-color='#d4d4d8'/></linearGradient></defs>" +
    "<rect width='640' height='180' fill='url(#g)'/>" +
    "<path d='M0 180 L150 0 H210 L60 180Z' fill='#DC0000' opacity='0.18'/><path d='M60 180 L210 0 H232 L82 180Z' fill='#111113' opacity='0.12'/>" +
    "<rect y='132' width='640' height='48' fill='#3f3f46'/><path d='M0 156 H640' stroke='#f4f4f5' stroke-width='4' stroke-dasharray='34 26'/>" +
    "<g transform='translate(140 -6)'>" +
    "<path d='M40 118 L70 98 L130 92 L170 78 L230 82 L262 100 L292 104 L292 122 L40 122 Z' fill='#DC0000'/>" +
    "<rect x='258' y='84' width='40' height='6' fill='#DC0000'/><rect x='30' y='96' width='22' height='5' fill='#DC0000'/>" +
    "<circle cx='96' cy='126' r='24' fill='#111113' stroke='#8b8b95' stroke-width='4'/><circle cx='236' cy='126' r='24' fill='#111113' stroke='#8b8b95' stroke-width='4'/>" +
    "</g>" +
    "<text x='480' y='78' font-family='Arial' font-weight='bold' font-size='40' fill='#111113' text-anchor='middle'>SF-23</text>",
  640,
);
const IMG_FERRARI_LOGO = svg(
  "<path d='M105 22 H215 V92 Q215 140 160 160 Q105 140 105 92 Z' fill='#FFD60A' stroke='#111113' stroke-width='4'/>" +
    "<rect x='105' y='22' width='110' height='14' fill='#22C55E'/><rect x='105' y='36' width='110' height='8' fill='#f4f4f5'/><rect x='105' y='44' width='110' height='8' fill='#DC0000'/>" +
    "<text x='160' y='104' font-family='Arial' font-weight='bold' font-size='34' fill='#111' text-anchor='middle'>SF</text>" +
    "<text x='160' y='130' font-family='Arial' font-weight='bold' font-size='16' fill='#DC0000' text-anchor='middle'>FERRARI</text>",
);
const IMG_REDBULL = svg(
  "<rect x='40' y='34' width='240' height='112' rx='16' fill='#1E3A8A'/>" +
    "<circle cx='160' cy='78' r='28' fill='#FFD60A'/><path d='M96 78 h36 M188 78 h36' stroke='#DC0000' stroke-width='12'/>" +
    "<text x='160' y='128' font-family='Arial' font-weight='bold' font-size='18' fill='#fff' text-anchor='middle'>RED BULL RACING</text>",
);
const IMG_TROPHY = svg(
  "<defs><linearGradient id='g' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#f4f4f5'/><stop offset='1' stop-color='#d4d4d8'/></linearGradient></defs>" +
    "<rect width='640' height='180' fill='url(#g)'/>" +
    "<path d='M400 180 L520 0 H580 L460 180Z' fill='#DC0000' opacity='0.18'/><path d='M460 180 L580 0 H602 L482 180Z' fill='#111113' opacity='0.12'/>" +
    "<path d='M0 0 H120 L0 120Z' fill='#111113' opacity='0.06'/>" +
    "<g transform='translate(320 40) scale(0.78) translate(-160 -38)'>" +
    "<path d='M115 38 H205 V82 Q205 118 160 124 Q115 118 115 82 Z' fill='#FFD60A' stroke='#B8860B' stroke-width='3'/>" +
    "<path d='M115 50 H92 Q92 86 118 92 M205 50 H228 Q228 86 202 92' fill='none' stroke='#FFD60A' stroke-width='8'/>" +
    "<rect x='150' y='124' width='20' height='26' fill='#FFD60A'/><rect x='126' y='150' width='68' height='12' fill='#FFD60A'/>" +
    "</g>" +
    "<text x='470' y='96' font-family='Arial' font-weight='bold' font-size='44' fill='#111113' text-anchor='middle'>2023</text>",
  640,
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

function readMeta(): { name: string; timeLimitSeconds: number } {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) {
      const m = JSON.parse(raw);
      return {
        name: typeof m.name === "string" && m.name ? m.name : DEFAULT_NAME,
        timeLimitSeconds: Number.isFinite(m.timeLimitSeconds) ? Math.max(0, m.timeLimitSeconds) : DEFAULT_TIME,
      };
    }
  } catch {
    // ใช้ค่าเริ่มต้น
  }
  return { name: DEFAULT_NAME, timeLimitSeconds: DEFAULT_TIME };
}

// ภาพตัวอย่างรุ่นแรกมีพื้นหลังสีดำ (#161616) ซึ่งไม่เข้ากับธีมสว่าง จึงสลับเป็นภาพชุดใหม่ให้อัตโนมัติ (เฉพาะภาพตัวอย่างเดิมที่ยังไม่ถูกแก้)
function migrateLegacyImages(pairs: MatchPair[]): { pairs: MatchPair[]; changed: boolean } {
  const legacy = (u?: string) => !!u && u.startsWith("data:image/svg+xml") && u.includes("%23161616");
  const oldBanner = (p: MatchPair) =>
    (p.id === "p7" || p.id === "p8") && !!p.promptImage?.startsWith("data:image/svg+xml") && p.promptImage.includes("%20320%20180");
  if (!pairs.some((p) => legacy(p.promptImage) || legacy(p.answerImage) || oldBanner(p))) return { pairs, changed: false };
  const seed = new Map(seedPairs().map((p) => [p.id, p]));
  return {
    changed: true,
    pairs: pairs.map((p) => {
      const fresh = seed.get(p.id);
      if (!fresh) return p;
      return {
        ...p,
        promptImage: legacy(p.promptImage) || oldBanner(p) ? fresh.promptImage : p.promptImage,
        answerImage: legacy(p.answerImage) ? fresh.answerImage : p.answerImage,
      };
    }),
  };
}

function readPairs(): MatchPair[] {
  const raw = localStorage.getItem(PAIRS_KEY);
  if (raw) {
    try {
      const parsed = recordsToPairs(JSON.parse(raw));
      if (parsed.length >= 2) {
        const { pairs, changed } = migrateLegacyImages(parsed);
        if (changed) localStorage.setItem(PAIRS_KEY, JSON.stringify(pairs.map(toSpecRecord)));
        return pairs;
      }
    } catch {
      // ตกไปใช้ข้อมูลเริ่มต้น
    }
  }
  const seeded = seedPairs();
  localStorage.setItem(PAIRS_KEY, JSON.stringify(seeded.map(toSpecRecord)));
  return seeded;
}

export async function getGame(): Promise<Theme> {
  const meta = readMeta();
  return {
    id: "f1-board",
    name: meta.name,
    timeLimitSeconds: meta.timeLimitSeconds,
    pairs: readPairs(),
    createdAt: 0,
    updatedAt: 0,
  };
}

export async function saveGame(game: Theme): Promise<Theme> {
  localStorage.setItem(PAIRS_KEY, JSON.stringify(game.pairs.map(toSpecRecord)));
  localStorage.setItem(
    META_KEY,
    JSON.stringify({ name: game.name, timeLimitSeconds: game.timeLimitSeconds }),
  );
  return { ...game, updatedAt: Date.now() };
}

export function exportGameJson(game: Theme): string {
  return JSON.stringify(
    { name: game.name, timeLimitSeconds: game.timeLimitSeconds, pairs: game.pairs.map(toSpecRecord) },
    null,
    2,
  );
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
