export type PromptType = "text" | "image" | "mixed";

// คำตอบ 1 ใบ (การ์ดในคลังคำตอบ) — 1 คำถามมีได้หลายคำตอบ ต้องวางให้ครบทุกใบถึงจะถูก
export interface AnswerOption {
  id: string;
  type: PromptType;
  text: string;
  image?: string;
}

export interface MatchPair {
  id: string;
  // คำถาม (ฝั่งซ้าย)
  promptType: PromptType;
  promptText: string;
  promptImage?: string; // data URL หรือลิงก์ http(s)
  // คำตอบ (ฝั่งขวา / คลังคำตอบ) — ต้องมีอย่างน้อย 1 ใบ
  answers: AnswerOption[];
}

export interface Theme {
  id: string;
  name: string;
  timeLimitSeconds: number; // 0 = ไม่จำกัดเวลา
  pairs: MatchPair[];
  createdAt: number;
  updatedAt: number;
}
