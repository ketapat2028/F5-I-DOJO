export type PromptType = "text" | "image" | "mixed";

export interface MatchPair {
  id: string;
  // คำถาม (ฝั่งซ้าย)
  promptType: PromptType;
  promptText: string;
  promptImage?: string; // data URL หรือลิงก์ http(s)
  // คำตอบ (ฝั่งขวา / คลังคำตอบ)
  answerType: PromptType;
  answerText: string;
  answerImage?: string;
  // วิดีโอสอน (แสดงเมื่อตอบข้อนี้ผิด)
  videoUrl?: string;
  videoTitle?: string;
  videoDesc?: string;
}

export interface Theme {
  id: string;
  name: string;
  timeLimitSeconds: number; // 0 = ไม่จำกัดเวลา
  pairs: MatchPair[];
  createdAt: number;
  updatedAt: number;
}
