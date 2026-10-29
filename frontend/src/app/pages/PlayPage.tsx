import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeftRight, Check, Circle, CircleCheck, CircleX, Eye, Flag, Info, Layers, Loader2, Plus, Trophy, X } from "lucide-react";
import { Confetti } from "../components/Confetti";
import { F1Header } from "../components/F1Header";
import { Button } from "../components/ui/button";
import { cn } from "../components/ui/utils";
import type { MatchPair, PromptType, Theme } from "../types/theme";
import { getGame, NoGameError } from "../utils/gameStore";
import { forwardKeys, isEmbedded, listenPortal, sendResult, type PortalAck, type PortalResult } from "../utils/portalBridge";

type Phase = "idle" | "running" | "finished" | "timeout";
type Chip = { id: string; pairId: string; text: string; letter: string; type: PromptType; image?: string };
type PlacedCard = { label: string; correct: boolean };
type WrongItem = {
  pairId: string;
  topic: string;
  placedCards: PlacedCard[]; // การ์ดที่วางไว้ แต่ละใบบอกเองว่าถูกหรือผิด
  correctCards: string[]; // คำตอบที่ถูกจริงทั้งหมด (โชว์ตอนกด เฉลย)
  missingCount: number; // ใส่ถูกครบทุกใบที่วาง แต่ยังขาดอีกกี่ใบ
};
type ModalData = {
  allCorrect: boolean;
  isTimeout: boolean;
  score: number;
  total: number;
  timeUsedSeconds: number;
  wrong: WrongItem[];
  mistakes: number;
  accuracy: number;
};
type PortalStatus = "idle" | "sending" | "sent" | "error";
type PortalReport = { result: PortalResult; score: number };
// ตำแหน่งช่องคำตอบ: ข้อไหน ช่องที่เท่าไร (ข้อที่มีหลายคำตอบมีหลายช่อง)
type SlotRef = { pairId: string; index: number };
type Spot = SlotRef | "bank";
type Burst = { id: number; x: number; y: number; ok: boolean | null };
type DragState = { chipId: string; from: Spot; x: number; y: number; dx: number; dy: number; w: number; h: number };

// portal ไม่ตอบ ack ภายในเวลานี้ = ถือว่ายังไม่ได้บันทึก (PORTAL_INTEGRATION.md ข้อ 2)
const ACK_TIMEOUT_MS = 10_000;
// บนจอ Station ต้องมีเวลาจำกัดเสมอ ไม่งั้นตอบไม่ครบจะไม่มีผล fail ส่งไปที่จอ
const EMBED_DEFAULT_LIMIT = 300;
// ลากเกินระยะนี้ (px) ถึงนับเป็นการลาก ไม่งั้นนับเป็นคลิก
const DRAG_THRESHOLD = 6;
// อีโมจิใช้เป็นเอฟเฟกต์ตอนคลิก/วางเท่านั้น ไม่ใช้ในข้อความ UI
const BURST_EMOJI = ["🔥", "🏎️", "💨", "🔥", "🏎️", "🔥", "💨", "🏎️"];

// เวลาที่ใช้จริง: ตอนถูกฝังแต่ตั้งไว้ 0 (ไม่จำกัด) ใช้ 5 นาทีแทน
function effectiveLimit(game: Theme, embedded: boolean): number {
  return embedded && game.timeLimitSeconds <= 0 ? EMBED_DEFAULT_LIMIT : game.timeLimitSeconds;
}

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ตัวอักษร A, B, C... ติดตามตำแหน่งหลังสลับ เพื่อไม่ให้ลำดับตัวอักษรเฉลยคำตอบ
// 1 คำถามมีได้หลายคำตอบ — แต่ละคำตอบกลายเป็นการ์ดของตัวเอง ผูกกลับไปที่คำถามด้วย pairId
function makeChips(pairs: MatchPair[]): Chip[] {
  const flat = pairs.flatMap((p) =>
    p.answers.map((a) => ({ id: a.id, pairId: p.id, text: a.text, type: a.type, image: a.image })),
  );
  return shuffle(flat).map((c, i) => ({ ...c, letter: String.fromCharCode(65 + i) }));
}

// ช่องว่างตามจำนวนคำตอบของแต่ละข้อ — ตำแหน่งในอาร์เรย์ = เลขช่อง
function emptySlots(game: Theme): Record<string, (string | null)[]> {
  return Object.fromEntries(game.pairs.map((p) => [p.id, p.answers.map(() => null)]));
}

const slotKey = (ref: SlotRef) => `${ref.pairId}:${ref.index}`;

function chipLabel(chip: Chip | undefined): string | null {
  return chip ? `${chip.letter}. ${chip.text || "(ภาพ)"}` : null;
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function resultTier(score: number, total: number): { title: string; sub?: string } {
  if (score === total) return { title: "PERFECT LAP!", sub: "รถแข่งพุ่งผ่านธงตาหมากรุก!" };
  if (score * 8 >= total * 3) return { title: "PODIUM FINISH!" };
  return { title: "KEEP PUSHING!" };
}

function GameTitle({ name }: { name: string }) {
  // "I-DOJO - PIT 5 DOMINO IMPACT" → ส่วนหลัง " - " เป็นสีน้ำเงิน
  const m = name.match(/^(.*?\S)\s+-\s+(.+)$/);
  return (
    <h1 className="f1-font-display text-lg font-bold leading-tight text-f1-ink sm:text-2xl">
      <Flag className="mr-2 inline size-5 align-[-0.1em] text-f1-brand sm:size-6" />
      {m ? `${m[1]} - ` : name}
      {m && <span className="text-f1-brand">{m[2]}</span>}
    </h1>
  );
}

// นาฬิกาแข่ง: ตัวเลขใหญ่ + วงแหวนเวลาที่เหลือ · ≤ 60 วิ แดงกะพริบ · ≤ 10 วิ กรอบเต้น
// อยู่แถวเดียวกับชื่อเกม ไม่กินแถวของพื้นที่เล่น
function RaceClock({ remaining, elapsed, limit, running }: { remaining: number | null; elapsed: number; limit: number; running: boolean }) {
  const low = remaining !== null && remaining <= 60;
  const critical = remaining !== null && remaining <= 10;
  const ratio = remaining !== null && limit > 0 ? remaining / limit : 1;
  const R = 15;
  const C = 2 * Math.PI * R;
  return (
    <div
      className={cn(
        "flex h-11 shrink-0 items-center gap-2 rounded-full border-2 pl-1.5 pr-4 shadow-md transition-colors duration-500 sm:h-14 sm:gap-3 sm:pr-5",
        low && running ? "border-f1-wrong shadow-[0_0_24px_rgba(220,0,0,0.6)]" : "border-f1-brand",
        critical && running && "f1-clock-pulse",
      )}
      style={{ backgroundColor: "#0b1f3a" }}
      role="timer"
      aria-label={remaining !== null ? "เวลาที่เหลือ" : "เวลาที่ใช้"}
    >
      <svg viewBox="0 0 36 36" className="size-8 shrink-0 -rotate-90 sm:size-11">
        <circle cx="18" cy="18" r={R} fill="none" strokeWidth="4" className="stroke-white/15" />
        <circle
          cx="18"
          cy="18"
          r={R}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - ratio)}
          className={cn(
            "transition-[stroke-dashoffset,stroke] duration-1000 ease-linear",
            remaining === null ? "stroke-white/40" : low ? "stroke-f1-wrong-bright" : "stroke-f1-brand-bright",
          )}
        />
      </svg>
      <span
        className={cn(
          "f1-font-mono text-2xl font-bold tabular-nums leading-none sm:text-4xl lg:text-5xl",
          low && running ? "f1-timer-blink text-f1-wrong-bright" : "text-white",
        )}
      >
        {formatTime(remaining ?? elapsed)}
      </span>
    </div>
  );
}

// ไฟ + รถ พุ่งออกจากจุดที่คลิก/วาง แล้วจางหาย (ลบตัวเองหลังจบแอนิเมชัน)
function BurstFx({ burst }: { burst: Burst }) {
  return (
    <div className="pointer-events-none fixed z-[90]" style={{ left: burst.x, top: burst.y }}>
      {BURST_EMOJI.map((emoji, i) => {
        const angle = (i / BURST_EMOJI.length) * Math.PI * 2 + burst.id;
        const dist = 46 + (i % 3) * 18;
        return (
          <span
            key={i}
            className="f1-burst-piece"
            style={
              {
                "--dx": `${Math.cos(angle) * dist}px`,
                "--dy": `${Math.sin(angle) * dist}px`,
                "--rot": `${(i % 2 ? 1 : -1) * 40}deg`,
              } as React.CSSProperties
            }
          >
            {emoji}
          </span>
        );
      })}
      {burst.ok !== null && (
        <span
          className={cn(
            "f1-burst-ring absolute rounded-full border-4",
            burst.ok ? "border-[#15803D]" : "border-f1-wrong",
          )}
        />
      )}
    </div>
  );
}

export function PlayPage() {
  const [game, setGame] = useState<Theme | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [chips, setChips] = useState<Chip[]>([]);
  // key = pair.id · value = chip id ตามตำแหน่งช่อง (null = ว่าง) ความยาว = pair.answers.length
  const [slots, setSlots] = useState<Record<string, (string | null)[]>>({});
  // การ์ดที่คลิกเลือกไว้จากคลัง/ช่อง รอคลิกช่องปลายทาง
  const [selectedChipId, setSelectedChipId] = useState<string | null>(null);
  // นับทุกครั้งที่วางการ์ดลงช่อง · วางผิดไม่ลงโทษ แค่นับ → score ที่ส่ง portal = ความแม่นยำ
  const [attempts, setAttempts] = useState(0);
  const [mistakes, setMistakes] = useState(0);
  // ช่องที่เพิ่งวาง ใช้เล่นเอฟเฟกต์รถวิ่ง/ธงแดง (n เปลี่ยนทุกครั้ง ให้แอนิเมชันเริ่มใหม่)
  const [lastDrop, setLastDrop] = useState<{ key: string; ok: boolean; n: number } | null>(null);
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverTarget, setHoverTarget] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [modalData, setModalData] = useState<ModalData | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  // แผง "คำตอบที่เหลือ" (เลื่อนขึ้นจากล่าง) · target = เปิดจากการคลิกช่องว่าง → คลิกการ์ดแล้ววางลงช่องนั้นเลย
  const [sheet, setSheet] = useState<{ target: SlotRef | null } | null>(null);
  // ตรวจคำตอบ = บอกแค่ถูก/ผิด · ต้องกดปุ่มเฉลยแยกต่างหากถึงจะเห็นคำตอบที่ถูกจริง
  const [showAnswerKey, setShowAnswerKey] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [portalStatus, setPortalStatus] = useState<PortalStatus>("idle");
  const [portalMsg, setPortalMsg] = useState<string | null>(null);

  const embedded = isEmbedded();
  // ผลที่ส่งแล้วกำลังรอ ack (กันส่งซ้ำ) และผลล่าสุดไว้กด "ส่งใหม่"
  const pendingRef = useRef<PortalReport | null>(null);
  const lastReportRef = useRef<PortalReport | null>(null);
  const ackTimerRef = useRef<number | null>(null);
  const portalStatusRef = useRef<PortalStatus>("idle");
  portalStatusRef.current = portalStatus;
  const burstIdRef = useRef(0);
  // ตัวจัดการลากใช้ listener บน window — อ้างฟังก์ชันของ render ล่าสุดผ่าน ref
  const dropRef = useRef<(chipId: string, from: Spot, x: number, y: number, dragged: boolean) => void>(() => {});

  useEffect(() => {
    setLoadError(null);
    getGame()
      .then((g) => {
        setGame(g);
        setChips(makeChips(g.pairs));
        setSlots(emptySlots(g));
        // บนจอ Station เริ่มนับเวลาทันที ไม่รอผู้เล่นแตะ
        if (embedded) setPhase("running");
      })
      .catch((e) => {
        setLoadError(
          e instanceof NoGameError
            ? "ยังไม่มีชุดคำถาม — ให้ผู้ดูแลตั้งค่าที่หน้า /I-DOJO/editor"
            : `โหลดชุดคำถามไม่ได้${e instanceof Error ? ` (${e.message})` : ""}`,
        );
      });
  }, [loadAttempt]);

  useEffect(() => {
    function handleAck(ack: PortalAck) {
      // ack ที่มาช้ากว่า ACK_TIMEOUT_MS ของผลเดียวกัน ยังนับ (จอบันทึกแล้ว ไม่ต้องกดส่งใหม่)
      const late = !pendingRef.current && portalStatusRef.current === "error" && ack.result === lastReportRef.current?.result;
      if (!pendingRef.current && !late) return;
      if (ackTimerRef.current) window.clearTimeout(ackTimerRef.current);
      pendingRef.current = null;
      setPortalStatus(ack.ok ? "sent" : "error");
      setPortalMsg(ack.ok ? null : (ack.message ?? "จอบันทึกผลไม่สำเร็จ"));
    }
    const stopListen = listenPortal(handleAck);
    const stopKeys = forwardKeys();
    return () => {
      stopListen();
      stopKeys();
      if (ackTimerRef.current) window.clearTimeout(ackTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (phase !== "running") return;
    const timer = setInterval(() => setElapsed((prev) => prev + 1), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "running" || !game) return;
    const limit = effectiveLimit(game, embedded);
    if (limit > 0 && elapsed >= limit) {
      handleCheck(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, phase, game]);

  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheet(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet]);

  // วางถูกครบทุกข้อ = เข้าเส้นชัยทันที ไม่ต้องกดตรวจ
  useEffect(() => {
    if (!game || phase === "finished" || phase === "timeout") return;
    const allDone = game.pairs.every((p) =>
      (slots[p.id] ?? []).every((id, i, arr) => arr.length === p.answers.length && id !== null && chipPairId(id) === p.id),
    );
    if (allDone && game.pairs.length > 0) handleCheck(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots]);

  if (!game) {
    return (
      <div className="f1-paper-bg min-h-screen">
        <F1Header />
        <main className="f1-font-display mx-auto max-w-3xl space-y-3 p-6 text-f1-brand">
          <p>{loadError ?? "กำลังโหลด..."}</p>
          {loadError && (
            <Button className="bg-f1-brand text-white hover:bg-f1-brand-dark" onClick={() => setLoadAttempt((n) => n + 1)}>
              ลองใหม่
            </Button>
          )}
        </main>
      </div>
    );
  }

  const chipById = new Map(chips.map((c) => [c.id, c]));
  function chipPairId(id: string): string | undefined {
    return chips.find((c) => c.id === id)?.pairId;
  }
  const slotsOf = (pairId: string) => slots[pairId] ?? [];
  const isCorrectAt = (chipId: string | null, pairId: string) => chipId !== null && chipById.get(chipId)?.pairId === pairId;
  // ข้อที่ถูกครบทุกช่อง — การ์ดที่ถูกล็อกอยู่กับที่ ลาก/ลบไม่ได้
  const lockedCorrect = new Set(
    game.pairs.filter((p) => slotsOf(p.id).length > 0 && slotsOf(p.id).every((id) => isCorrectAt(id, p.id))).map((p) => p.id),
  );
  const placedIds = new Set(Object.values(slots).flat().filter((id): id is string => id !== null));

  const total = game.pairs.length;
  const totalSlots = game.pairs.reduce((sum, p) => sum + p.answers.length, 0);
  const totalPlaced = placedIds.size;
  const hasAnyPlaced = totalPlaced > 0;
  const pool = chips.filter((c) => !placedIds.has(c.id));
  const limit = effectiveLimit(game, embedded);
  const hasLimit = limit > 0;
  const remaining = hasLimit ? Math.max(0, limit - elapsed) : null;
  const lowTime = remaining !== null && remaining <= 60;
  const locked = phase === "finished" || phase === "timeout";
  // ตอนถูกฝัง: ส่งผลไปแล้ว (กำลังรอ/ได้ ack) → ไม่ให้เล่นต่อเอง รอจอจัดการ
  const resultHandedOff = embedded && (portalStatus === "sending" || portalStatus === "sent");
  const accuracy = attempts > 0 ? Math.round((100 * (attempts - mistakes)) / attempts) : 0;

  function startIfIdle() {
    setPhase((p) => (p === "idle" ? "running" : p));
  }

  // ส่งผลขึ้นจอ Station เฉพาะตอนถูกฝัง · ระหว่างรอ ack ห้ามส่งซ้ำ
  function report(next: PortalReport) {
    if (!embedded || pendingRef.current) return;
    pendingRef.current = next;
    lastReportRef.current = next;
    setPortalStatus("sending");
    setPortalMsg(null);
    sendResult(next.result, next.score);
    ackTimerRef.current = window.setTimeout(() => {
      pendingRef.current = null;
      setPortalStatus("error");
      setPortalMsg("ยังไม่ได้รับการยืนยันจากจอ");
    }, ACK_TIMEOUT_MS);
  }

  function resendReport() {
    if (lastReportRef.current) report(lastReportRef.current);
  }

  function resetAll() {
    if (!game) return;
    // ผลที่ยังรอ ack อยู่ปล่อยให้รอต่อ ส่วนสถานะอื่นเริ่มใหม่
    if (!pendingRef.current) {
      setPortalStatus("idle");
      setPortalMsg(null);
    }
    setChips(makeChips(game.pairs));
    setSlots(emptySlots(game));
    setSelectedChipId(null);
    setSheet(null);
    setAttempts(0);
    setMistakes(0);
    setLastDrop(null);
    setElapsed(0);
    setModalData(null);
    setShowAnswerKey(false);
    setPhase("idle");
  }

  // เอาการ์ดที่วางผิดกลับคลัง (การ์ดที่ถูกล็อกไว้แล้วคงอยู่)
  function clearWrong() {
    setSlots((prev) =>
      Object.fromEntries(Object.entries(prev).map(([pairId, arr]) => [pairId, arr.map((id) => (isCorrectAt(id, pairId) ? id : null))])),
    );
    setSelectedChipId(null);
  }

  function spark(x: number, y: number, ok: boolean | null) {
    const id = ++burstIdRef.current;
    setBursts((prev) => [...prev, { id, x, y, ok }]);
    window.setTimeout(() => setBursts((prev) => prev.filter((b) => b.id !== id)), 900);
  }

  // เลขช่องแบบที่แสดงบนจอ: ข้อเดี่ยว "3" · ข้อหลายคำตอบ "3.2"
  function slotLabel(ref: SlotRef): string {
    const idx = game!.pairs.findIndex((p) => p.id === ref.pairId);
    const cap = game!.pairs[idx]?.answers.length ?? 1;
    return cap > 1 ? `${idx + 1}.${ref.index + 1}` : `${idx + 1}`;
  }

  function slotCenter(ref: SlotRef): { x: number; y: number } {
    const r = document.querySelector(`[data-answer-slot="${slotKey(ref)}"]`)?.getBoundingClientRect();
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: innerWidth / 2, y: innerHeight / 2 };
  }

  function locate(chipId: string): Spot {
    for (const [pairId, arr] of Object.entries(slots)) {
      const index = arr.indexOf(chipId);
      if (index >= 0) return { pairId, index };
    }
    return "bank";
  }

  // วางการ์ดลงช่อง/คลัง · ช่องที่มีการ์ดถูกอยู่แล้ววางทับไม่ได้ · ช่องที่มีการ์ดผิด → สลับ (การ์ดเดิมไปอยู่ที่ต้นทาง)
  function placeChip(chipId: string, target: Spot, at?: { x: number; y: number }) {
    if (locked) return;
    const from = locate(chipId);
    if (from !== "bank" && isCorrectAt(chipId, from.pairId)) return;
    const next = Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, [...v]]));
    if (target === "bank") {
      if (from === "bank") return;
      next[from.pairId][from.index] = null;
      setSlots(next);
      setSelectedChipId(null);
      if (at) spark(at.x, at.y, null);
      return;
    }
    const occupant = next[target.pairId]?.[target.index] ?? null;
    if (occupant === chipId) return;
    const point = at ?? slotCenter(target);
    if (occupant && isCorrectAt(occupant, target.pairId)) {
      spark(point.x, point.y, false);
      return;
    }
    if (from !== "bank") next[from.pairId][from.index] = occupant; // สลับ (ถ้าช่องปลายทางว่าง = ล้างต้นทาง)
    next[target.pairId][target.index] = chipId;
    const ok = isCorrectAt(chipId, target.pairId);
    setSlots(next);
    setSelectedChipId(null);
    setAttempts((n) => n + 1);
    if (!ok) setMistakes((n) => n + 1);
    setLastDrop((prev) => ({ key: slotKey(target), ok, n: (prev?.n ?? 0) + 1 }));
    spark(point.x, point.y, ok);
    startIfIdle();
  }

  // คลิกการ์ด (ไม่ได้ลาก): มีการ์ดเลือกไว้แล้วและคลิกการ์ดผิดในช่อง → วางทับ · ไม่งั้นสลับการเลือก
  function handleCardClick(chipId: string, from: Spot, x: number, y: number) {
    if (locked) return;
    // คลิกการ์ดในแผงคำตอบที่เหลือ: เปิดจากช่องว่าง → วางลงช่องนั้นเลย · เปิดจากปุ่ม → เลือกไว้แล้วปิดแผง ให้คลิกช่องต่อ
    if (from === "bank" && sheet) {
      setSheet(null);
      if (sheet.target) {
        placeChip(chipId, sheet.target, { x, y });
        return;
      }
      setSelectedChipId(chipId);
      spark(x, y, null);
      startIfIdle();
      return;
    }
    if (selectedChipId && selectedChipId !== chipId && from !== "bank") {
      placeChip(selectedChipId, from, { x, y });
      return;
    }
    setSelectedChipId((cur) => (cur === chipId ? null : chipId));
    spark(x, y, null);
    startIfIdle();
  }

  function handleSlotClick(ref: SlotRef, e: React.MouseEvent) {
    if (locked || slotsOf(ref.pairId)[ref.index]) return;
    if (selectedChipId) {
      placeChip(selectedChipId, ref, { x: e.clientX, y: e.clientY });
      return;
    }
    startIfIdle();
    setSheet({ target: ref });
  }

  dropRef.current = (chipId, from, x, y, dragged) => {
    if (!dragged) {
      handleCardClick(chipId, from, x, y);
      return;
    }
    // ลากจากแผงแล้ว = ไม่ผูกกับช่องที่คลิกเปิดแผงอีก (แผงกลับขึ้นมาเองเพื่อลากใบถัดไป)
    if (sheet?.target) setSheet({ target: null });
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-answer-slot],[data-bank]");
    if (!el) return; // ปล่อยนอกช่อง = การ์ดกลับที่เดิม
    if (el.dataset.bank !== undefined) {
      placeChip(chipId, "bank", { x, y });
      return;
    }
    const [pairId, index] = (el.dataset.answerSlot ?? "").split(":");
    if (!slots[pairId] || !(Number(index) in slots[pairId])) return;
    placeChip(chipId, { pairId, index: Number(index) }, { x, y });
  };

  // ลากด้วย pointer events — ใช้ได้ทั้งเมาส์และนิ้ว (การ์ดตั้ง touch-action: none ไว้ ไม่ให้หน้าเลื่อนตอนลาก)
  function startPointer(e: ReactPointerEvent<HTMLElement>, chipId: string, from: Spot) {
    if (locked || e.button !== 0) return;
    if (from !== "bank" && isCorrectAt(chipId, from.pairId)) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      dragging = true;
      setDrag({ chipId, from, x: ev.clientX, y: ev.clientY, dx: startX - rect.left, dy: startY - rect.top, w: rect.width, h: rect.height });
      const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>("[data-answer-slot],[data-bank]");
      setHoverTarget(over ? (over.dataset.answerSlot ?? "bank") : null);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDrag(null);
      setHoverTarget(null);
      if (ev.type !== "pointercancel") dropRef.current(chipId, from, ev.clientX, ev.clientY, dragging);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function handleCheck(isAuto: boolean) {
    if (!game) return;
    if (!isAuto && !hasAnyPlaced) return;
    const wrong: WrongItem[] = [];
    let score = 0;
    for (const pair of game.pairs) {
      const placed = (slots[pair.id] ?? []).filter((id): id is string => id !== null);
      const correctIds = new Set(pair.answers.map((a) => a.id));
      const isCorrect = placed.length === pair.answers.length && placed.every((id) => correctIds.has(id));
      if (isCorrect) {
        score++;
        continue;
      }
      wrong.push({
        pairId: pair.id,
        topic: pair.promptText || "(ภาพ)",
        placedCards: placed.map((id) => ({
          label: chipLabel(chipById.get(id)) ?? "?",
          correct: correctIds.has(id),
        })),
        correctCards: pair.answers.map((a) => chipLabel(chipById.get(a.id)) ?? (a.text || "(ภาพ)")),
        missingCount: pair.answers.length - placed.length,
      });
    }
    setShowAnswerKey(false);
    setSelectedChipId(null);
    setSheet(null);
    const allCorrect = wrong.length === 0;
    setModalData({
      allCorrect,
      isTimeout: isAuto && !allCorrect,
      score,
      total: game.pairs.length,
      timeUsedSeconds: elapsed,
      wrong,
      mistakes,
      accuracy,
    });
    // ผิดแต่เวลายังเหลือ = ไม่ส่งผล ให้แก้ต่อจนถูกครบหรือหมดเวลา · score ที่ส่ง = ความแม่นยำในการวาง
    if (allCorrect) {
      setPhase("finished");
      report({ result: "pass", score: accuracy });
    } else if (isAuto) {
      setPhase("timeout");
      report({ result: "fail", score: accuracy });
    }
  }

  function retryWrongOnly() {
    clearWrong();
    setModalData(null);
    setShowAnswerKey(false);
  }

  // การ์ดคำตอบ (ใช้ทั้งในคลัง ในช่อง และตัวที่ลอยตามนิ้วตอนลาก)
  // compact = ช่องแคบ → ตัวหนังสือเล็กลงไม่ให้ล้นช่อง
  function renderChip(chip: Chip, compact = false) {
    const hasImg = chip.type !== "text" && Boolean(chip.image);
    const textClass = hasImg
      ? "line-clamp-2 text-[11px] sm:text-xs 2xl:text-sm"
      : compact
        ? "line-clamp-3 text-xs sm:text-sm lg:text-base"
        : "line-clamp-3 text-sm sm:text-base lg:text-xl 2xl:text-2xl";
    return (
      <div className="f1-font-display flex h-full w-full min-h-0 min-w-0 flex-col items-center justify-center gap-1 overflow-hidden p-1.5 text-center font-bold text-f1-ink">
        {hasImg && (
          <img src={chip.image} alt="" draggable={false} className="min-h-0 w-full flex-1 rounded-md object-contain" />
        )}
        <span className={cn("shrink-0 leading-snug", textClass)}>
          <span className="mr-1 text-f1-brand">{chip.letter}.</span>
          {chip.text}
        </span>
      </div>
    );
  }

  // การ์ดคำถาม: แถบเลขข้อสีน้ำเงินด้านซ้าย (เขียวเมื่อถูกครบ) · รูป (ถ้ามี) ไม่ยืด · ข้อความอยู่ข้างรูป
  function renderQuestion(pair: MatchPair, idx: number, done: boolean) {
    const hasImg = pair.promptType !== "text" && Boolean(pair.promptImage);
    // ทุกข้อจัดแบบเดียวกัน (รูปชิดซ้าย ข้อความข้างรูป) — ข้อแบบ "รูปภาพ" ที่มีข้อความกำกับก็แสดงด้วย ไม่งั้นหน้าตาต่างจากข้ออื่น
    const hasText = Boolean(pair.promptText);
    return (
      <div
        className={cn(
          "relative flex h-full w-full min-h-0 min-w-0 overflow-hidden rounded-xl border bg-white shadow-sm transition-all duration-300",
          done ? "border-[#15803D] ring-2 ring-[#15803D]/40" : "border-f1-line",
        )}
      >
        <span
          className={cn(
            "f1-font-mono flex w-6 shrink-0 items-center justify-center text-xs font-bold text-white transition-colors duration-300 sm:w-8 sm:text-sm lg:w-10 lg:text-lg",
            done ? "bg-[#15803D]" : "bg-f1-brand",
          )}
        >
          {done ? <Check className="size-4 lg:size-5" strokeWidth={3} /> : idx + 1}
        </span>
        {/* มือถือ: รูปอยู่บน ข้อความอยู่ล่าง (ช่องแคบ) · sm ขึ้นไป: รูปซ้าย ข้อความขวา */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-1 p-1 sm:flex-row sm:justify-start sm:gap-3 sm:p-2 lg:gap-5">
          {hasImg && (
            <img
              src={pair.promptImage}
              alt={pair.promptText}
              draggable={false}
              className={cn(
                "min-h-0 w-full min-w-0 flex-1 rounded-md object-contain sm:h-full sm:w-auto sm:max-w-[60%] sm:flex-none",
              )}
            />
          )}
          {hasText && (
            <span className="f1-font-display line-clamp-1 w-full min-w-0 shrink-0 px-1 text-center text-xs font-bold leading-tight text-f1-ink sm:line-clamp-3 sm:w-auto sm:flex-1 sm:text-left sm:text-base lg:text-xl 2xl:text-2xl">
              {pair.promptText}
            </span>
          )}
        </div>
        {done && <div className="f1-checkered-flash pointer-events-none absolute inset-0" />}
      </div>
    );
  }

  // ช่องคำตอบ 1 ช่อง — มีเลข index ของตัวเอง (ข้อ.ช่อง) คลิก/ลากวางได้ตรงช่องนั้นเลย
  function renderSlot(pair: MatchPair, idx: number, index: number) {
    const ref = { pairId: pair.id, index };
    const key = slotKey(ref);
    const chipId = slotsOf(pair.id)[index] ?? null;
    const chip = chipId ? chipById.get(chipId) : undefined;
    const ok = chip ? chip.pairId === pair.id : null;
    const capacity = pair.answers.length;
    const isHover = hoverTarget === key;
    const justDropped = lastDrop?.key === key;
    const isDragOrigin = drag && drag.from !== "bank" && slotKey(drag.from) === key;
    const canPlaceHere = !locked && ok !== true;
    return (
      <div
        key={index}
        data-answer-slot={key}
        onClick={(e) => handleSlotClick(ref, e)}
        className={cn(
          "relative flex h-full min-h-0 min-w-0 items-center justify-center rounded-xl border-2 transition-all duration-200",
          !chip && "border-dashed border-f1-line-strong bg-white/70",
          !chip && canPlaceHere && "cursor-pointer hover:border-f1-brand hover:bg-f1-brand/5",
          !chip && selectedChipId && canPlaceHere && "border-f1-brand bg-f1-brand/5",
          ok === true && "border-[#15803D] bg-f1-ok-bg",
          ok === false && "border-f1-wrong bg-f1-wrong/10",
          isHover && canPlaceHere && "scale-[1.03] border-dashed border-f1-brand bg-f1-brand/10 shadow-lg",
        )}
      >
        <span className="f1-font-mono pointer-events-none absolute left-1 top-1 z-10 rounded bg-white/90 px-1 text-[10px] font-bold leading-4 text-f1-brand shadow-sm">
          {slotLabel(ref)}
        </span>
        {chip ? (
          <div
            key={chip.id}
            onPointerDown={(e) => startPointer(e, chip.id, ref)}
            className={cn(
              "h-full w-full touch-none select-none",
              ok ? "f1-correct-bounce" : "f1-shake cursor-grab active:cursor-grabbing",
              isDragOrigin && "opacity-30",
            )}
          >
            {renderChip(chip, capacity > 2)}
          </div>
        ) : (
          <Plus className={cn("size-5 transition-transform", selectedChipId ? "scale-125 text-f1-brand" : "text-f1-line-strong")} />
        )}
        {chip && ok === false && !locked && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              placeChip(chip.id, "bank", { x: e.clientX, y: e.clientY });
            }}
            className="absolute -right-2 -top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-f1-brand text-white shadow transition-transform hover:scale-110"
            aria-label="เอาการ์ดกลับคลัง"
          >
            <X className="size-3.5" strokeWidth={3} />
          </button>
        )}
        {chip && (
          <span
            className={cn(
              "f1-pop-in absolute -bottom-2 -right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-white shadow",
              ok ? "bg-[#15803D]" : "bg-f1-wrong",
            )}
          >
            {ok ? <Check className="size-3.5" strokeWidth={3} /> : <X className="size-3.5" strokeWidth={3} />}
          </span>
        )}
        {justDropped && lastDrop.ok && (
          <span key={lastDrop.n} className="f1-car-zoom pointer-events-none absolute top-1/2 z-20 text-2xl">
            🏎️
          </span>
        )}
        {justDropped && !lastDrop.ok && (
          <div key={lastDrop.n} className="f1-redflag-flash pointer-events-none absolute inset-0 rounded-xl" />
        )}
      </div>
    );
  }

  // ช่องคำถามกับช่องคำตอบกว้างเท่ากัน (1fr | ลูกศร | 1fr) และสูงเท่าแถว — ทุกแถวสูงเท่ากันจาก auto-rows ของรายการ
  const rowGrid = "grid min-h-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] items-stretch gap-2 sm:gap-4 lg:gap-6";
  const tier = modalData ? resultTier(modalData.score, modalData.total) : null;
  const dragChip = drag ? chipById.get(drag.chipId) : undefined;
  const draggingFromSlot = drag !== null && drag.from !== "bank";
  const howToList = (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {(
        [
          ["L", "ซ้าย = คำถาม · ขวา = ช่องคำตอบ (แต่ละช่องมีเลขกำกับ เช่น 1.2 = ข้อ 1 ช่องที่ 2)"],
          ["1", "กดปุ่ม คำตอบที่เหลือ (ล่างซ้าย) แล้วลากการ์ดไปวางในช่องที่ต้องการ — แผงจะหลบให้ตอนลาก"],
          ["2", "หรือคลิกการ์ดในคลังให้เลือกไว้ แล้วคลิกช่องที่จะวาง (คลิกช่องว่างเฉยๆ จะเปิดรายการคำตอบให้เลือก)"],
          ["3", "วางแล้วรู้ผลทันที — เขียว = ถูก (ล็อกไว้) · แดง = ผิด ลากออก/กด ✕ หรือวางการ์ดใหม่ทับได้เลย"],
          ["4", "ถูกครบทุกช่อง = เข้าเส้นชัยทันที · วางผิดกี่ครั้งจะนับเป็นความแม่นยำตอนสรุปผล"],
        ] as const
      ).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="f1-font-mono flex h-6 w-6 items-center justify-center rounded-sm bg-f1-brand text-xs font-bold text-white">
            {k}
          </dt>
          <dd className="self-center">{v}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    // เต็มจอทุกอุปกรณ์ (h-dvh) — หน้าไม่เลื่อน ถ้าคำถามเยอะเกินจอ เลื่อนเฉพาะรายการคำถาม
    // ตอนถูกฝัง portal วางปุ่ม "ผ่านสถานี" ทับขอบล่าง ~90px จึงเว้นที่ไว้
    <div className={cn("f1-paper-bg flex h-dvh flex-col overflow-hidden", embedded && "pb-28", drag && "cursor-grabbing select-none")}>
      <F1Header />
      {/* แถบเวลาเต็มความกว้างติดใต้ header — บาง 3px ไม่กินพื้นที่เล่น */}
      <div className="h-[3px] w-full shrink-0 bg-zinc-200">
        {remaining !== null && (
          <div
            className={cn(
              "h-full transition-all duration-1000 ease-linear",
              lowTime && phase === "running" ? "f1-timer-blink bg-f1-wrong" : "bg-f1-brand",
            )}
            style={{ width: `${(remaining / limit) * 100}%` }}
          />
        )}
      </div>
      <main className="flex min-h-0 w-full flex-1 flex-col gap-2 px-3 py-2 sm:gap-3 sm:px-6 lg:px-12 fit:gap-2 fit:py-2">
        {/* แถวเดียว: ชื่อ + สถิติ | นาฬิกา | ปุ่ม */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-4">
          <div className="min-w-0 flex-1">
            <div className="truncate">
              <GameTitle name={game.name} />
            </div>
            <p className="f1-font-display mt-0.5 truncate text-[11px] font-medium tracking-wide text-f1-mute sm:text-xs">
              <span className="hidden sm:inline">ถูก </span>
              <strong className="text-f1-ok-ink">
                {lockedCorrect.size}/{total}
              </strong>
              <span className="hidden sm:inline"> ข้อ • วางแล้ว {totalPlaced}/{totalSlots}</span> • ผิด{" "}
              <strong className={mistakes > 0 ? "text-f1-wrong" : "text-f1-ink"}>{mistakes}</strong>
              <span className="hidden tracking-widest text-f1-brand lg:inline"> • DRAG • DROP • MATCH</span>
            </p>
          </div>

          <RaceClock remaining={remaining} elapsed={elapsed} limit={limit} running={phase === "running"} />

          <div className="flex shrink-0 gap-2">
            {!locked && (
              <Button
                disabled={!hasAnyPlaced}
                onClick={() => handleCheck(false)}
                aria-label="สรุปผล"
                className={cn(
                  "f1-font-display transition-all",
                  hasAnyPlaced ? "bg-f1-brand text-white hover:bg-f1-brand-dark" : "bg-zinc-200 text-zinc-500",
                )}
              >
                <Flag />
                <span className="hidden sm:inline">สรุปผล</span>
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setShowHelp(true)}
              className="f1-font-display shrink-0 border-f1-ink bg-white text-f1-ink hover:bg-zinc-100"
              aria-label="วิธีเล่น"
            >
              <Info /> <span className="hidden sm:inline">วิธีเล่น</span>
            </Button>
          </div>
        </div>

        <div className="f1-font-display grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 px-1 text-xs font-medium tracking-wide text-f1-brand sm:gap-4 lg:gap-6">
          <span># · คำถาม (ซ้าย)</span>
          <ArrowLeftRight className="size-4" />
          <span className="text-center">คำตอบ (ขวา)<span className="hidden sm:inline"> — ลากหรือคลิกวางได้ทุกช่อง</span></span>
        </div>

        {/* ทุกแถวสูงเท่ากันและแบ่งพื้นที่ที่เหลือของจอ · เตี้ยกว่า 6rem (มือถือ) / 4.5rem จะเลื่อนในกล่องนี้แทน */}
        {/* เว้นขอบ px-3/py-3 ไว้ให้ปุ่ม ✕ และป้าย ✓/✗ ที่ยื่นออกนอกมุมการ์ด ไม่ถูก overflow ตัด */}
        <div className="-mx-3 grid min-h-0 flex-1 auto-rows-[minmax(6rem,1fr)] gap-2 overflow-y-auto px-3 py-3 sm:auto-rows-[minmax(4.5rem,1fr)] sm:gap-3 fit:gap-2">
          {game.pairs.map((pair, idx) => {
            const capacity = pair.answers.length;
            return (
              <div key={pair.id} className={rowGrid}>
                {renderQuestion(pair, idx, lockedCorrect.has(pair.id))}
                <ArrowLeftRight className="size-4 self-center text-f1-brand" />
                <div
                  className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] gap-2"
                  style={{ gridTemplateColumns: `repeat(${capacity}, minmax(0, 1fr))` }}
                >
                  {Array.from({ length: capacity }, (_, i) => renderSlot(pair, idx, i))}
                </div>
              </div>
            );
          })}
        </div>

        {/* ปุ่มทางลัด "คำตอบที่เหลือ" เปิดแผงการ์ด · เป็นจุดปล่อย (data-bank) คืนการ์ดผิดกลับคลังด้วย */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            data-bank=""
            aria-disabled={pool.length === 0 || locked}
            onClick={() => {
              if (pool.length > 0 && !locked) setSheet({ target: null });
            }}
            className={cn(
              "f1-font-display flex h-11 items-center gap-2 rounded-full border-2 px-4 text-sm font-bold shadow-md transition-all duration-200 sm:h-12 sm:px-5 sm:text-base",
              draggingFromSlot
                ? "scale-105 border-dashed border-f1-brand bg-f1-brand/10 text-f1-brand"
                : pool.length > 0 && !locked
                  ? "border-f1-brand bg-f1-brand text-white hover:-translate-y-0.5 hover:bg-f1-brand-dark hover:shadow-lg active:translate-y-0"
                  : "border-f1-line bg-zinc-100 text-f1-mute",
              hoverTarget === "bank" && "scale-110 ring-4 ring-f1-brand/30",
              !hasAnyPlaced && pool.length > 0 && !draggingFromSlot && "f1-glow",
            )}
          >
            <Layers className="size-5" />
            <span>{draggingFromSlot ? "ปล่อยที่นี่เพื่อคืนคลัง" : pool.length > 0 ? "คำตอบที่เหลือ" : "วางครบแล้ว"}</span>
            {!draggingFromSlot && (
              <span
                key={pool.length}
                className={cn(
                  "f1-pop-in f1-font-mono flex h-6 min-w-6 items-center justify-center rounded-full bg-white px-1.5 text-xs",
                  pool.length > 0 && !locked ? "text-f1-brand" : "text-f1-mute",
                )}
              >
                {pool.length}
              </span>
            )}
          </button>
          <div className="ml-auto flex shrink-0 gap-2">
            {!locked && (
              <Button
                variant="outline"
                size="sm"
                className="f1-font-display border-f1-line-strong bg-white text-f1-ink hover:bg-zinc-100"
                onClick={clearWrong}
              >
                <span>
                  ล้าง<span className="hidden sm:inline">ช่องที่</span>ผิด
                </span>
              </Button>
            )}
            {/* บนจอ Station รีเซ็ตแล้วเวลาเริ่มใหม่ = เลี่ยงการหมดเวลา จึงไม่ให้กด */}
            {!embedded && (
              <Button
                variant="outline"
                size="sm"
                className="f1-font-display border-f1-brand bg-white text-f1-brand hover:bg-f1-brand/10"
                onClick={resetAll}
              >
                <span>
                  รีเซ็ต<span className="hidden sm:inline">ทั้งหมด</span>
                </span>
              </Button>
            )}
          </div>
        </div>

        <div className="f1-font-display hidden shrink-0 justify-between gap-6 overflow-hidden whitespace-nowrap text-[10px] text-f1-mute md:flex">
          <p>* กด คำตอบที่เหลือ แล้วลากการ์ดไปวาง หรือคลิกเลือกแล้วคลิกช่อง • เขียว = ถูก • แดง = ผิด</p>
          <p>I-DOJO - PIT 5 DOMINO IMPACT • LEFT QUESTION • RIGHT ANSWER • BLUE #1B4FA0 • WHITE • GREEN = CORRECT • RED = WRONG</p>
        </div>
      </main>

      {/* การ์ดที่ลอยตามเมาส์/นิ้วตอนลาก */}
      {drag && dragChip && (
        <div
          className="f1-dragging pointer-events-none fixed z-[85] rotate-3 scale-105 rounded-lg border-2 border-f1-brand bg-white shadow-2xl"
          style={{ left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.w, height: drag.h }}
        >
          {renderChip(dragChip, true)}
        </div>
      )}

      {bursts.map((b) => (
        <BurstFx key={b.id} burst={b} />
      ))}

      {showHelp && (
        <div
          className="f1-backdrop-fade fixed inset-0 z-[65] flex items-center justify-center overflow-y-auto bg-black/60 p-4"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="f1-font-display f1-modal-pop relative my-auto w-full max-w-xl rounded-sm border-4 border-f1-brand bg-white p-6 text-sm text-f1-ink"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowHelp(false)}
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-f1-brand font-bold text-white"
              aria-label="ปิดวิธีเล่น"
            >
              <X className="size-5" strokeWidth={3} />
            </button>
            <h2 className="mb-3 font-bold text-f1-brand">วิธีเล่น</h2>
            {howToList}
          </div>
        </div>
      )}

      {/* แผงคำตอบที่เหลือ — เลื่อนขึ้นจากล่าง · ตอนลากการ์ดแผงหลบลงไปให้เห็นทุกช่อง แล้วกลับขึ้นมาเองหลังวาง */}
      {sheet && pool.length > 0 && (
        <>
          <div
            className={cn(
              "f1-backdrop-fade fixed inset-0 z-[68] bg-black/25 transition-opacity duration-200",
              drag && "pointer-events-none opacity-0",
            )}
            onClick={() => setSheet(null)}
          />
          <div
            className={cn(
              "fixed inset-x-0 z-[70] mx-auto max-w-6xl px-2 transition-all duration-200 ease-out",
              embedded ? "bottom-28" : "bottom-0",
              drag && "pointer-events-none translate-y-full opacity-0",
            )}
          >
            <div className="f1-sheet-up f1-font-display rounded-t-2xl border-x border-t-4 border-f1-brand bg-white px-3 pb-3 pt-2 text-f1-ink shadow-[0_-12px_40px_rgba(11,31,58,0.25)] sm:px-5">
              <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-f1-line" />
              <div className="mb-2 flex items-center gap-2">
                <Layers className="size-5 shrink-0 text-f1-brand" />
                <h3 className="min-w-0 flex-1 truncate text-sm font-bold sm:text-base">
                  {sheet.target ? (
                    <>
                      เลือกคำตอบใส่ช่อง <span className="text-f1-brand">{slotLabel(sheet.target)}</span>
                    </>
                  ) : (
                    <>
                      คำตอบที่เหลือ <span className="text-f1-brand">{pool.length}</span> ใบ
                    </>
                  )}
                  <span className="hidden font-normal text-f1-mute sm:inline"> — ลากไปวาง หรือคลิกเลือก</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setSheet(null)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-f1-brand text-white transition-transform hover:scale-110"
                  aria-label="ปิด"
                >
                  <X className="size-5" strokeWidth={3} />
                </button>
              </div>
              <div className="grid max-h-[42dvh] grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-2 overflow-y-auto p-1 lg:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]">
                {pool.map((chip) => (
                  <div
                    key={chip.id}
                    data-sheet-card=""
                    onPointerDown={(e) => startPointer(e, chip.id, "bank")}
                    className={cn(
                      "f1-pop-in h-20 cursor-grab touch-none select-none rounded-lg border-2 border-f1-line bg-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-f1-brand hover:shadow-md active:cursor-grabbing lg:h-24",
                      selectedChipId === chip.id && "border-f1-brand ring-4 ring-f1-brand/30",
                    )}
                  >
                    {renderChip(chip, true)}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {modalData?.allCorrect && <Confetti />}

      {modalData && tier && (
        <div
          className={cn(
            "f1-backdrop-fade fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 p-4",
            embedded && "pb-28",
          )}
        >
          <div className="f1-font-display f1-modal-pop relative my-auto w-full max-w-lg rounded-sm border-4 border-f1-brand bg-white p-6 text-f1-ink">
            <button
              type="button"
              onClick={() => setModalData(null)}
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-f1-brand font-bold text-white"
              aria-label="ปิดผลตรวจ"
            >
              <X className="size-5" strokeWidth={3} />
            </button>
            <p className="px-6 text-center text-xs font-medium tracking-widest text-f1-brand">
              <Trophy className="inline size-4 align-text-bottom" /> RACE RESULT • SUMMARY
            </p>
            <p className="mt-1 px-6 text-center text-2xl font-bold">
              {modalData.isTimeout && "หมดเวลา! "}
              {tier.title}
            </p>
            {tier.sub && <p className="mt-1 text-center text-sm text-f1-brand">{tier.sub}</p>}

            {embedded && portalStatus !== "idle" && (
              <div
                className={cn(
                  "mt-3 flex flex-wrap items-center justify-center gap-2 rounded-sm px-3 py-2 text-center text-sm",
                  portalStatus === "sending" && "bg-zinc-100 text-f1-ink",
                  portalStatus === "sent" && "bg-f1-ok-bg text-f1-ok-ink",
                  portalStatus === "error" && "bg-f1-bad-bg text-f1-bad",
                )}
              >
                {portalStatus === "sending" && (
                  <>
                    <Loader2 className="size-4 animate-spin" /> กำลังส่งผลไปที่จอ…
                  </>
                )}
                {portalStatus === "sent" && (
                  <>
                    <Check className="size-4" /> ส่งผลไปที่จอแล้ว
                  </>
                )}
                {portalStatus === "error" && (
                  <>
                    <span>ส่งผลไม่สำเร็จ: {portalMsg}</span>
                    <Button size="sm" className="bg-f1-brand text-white hover:bg-f1-brand-dark" onClick={resendReport}>
                      ส่งใหม่
                    </Button>
                  </>
                )}
              </div>
            )}

            <div className="f1-font-mono mt-4 grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-sm bg-zinc-100 p-2">
                <p className="text-[10px] text-f1-brand">TIME USED</p>
                <p className="text-lg font-bold">{formatTime(modalData.timeUsedSeconds)}</p>
              </div>
              <div className="rounded-sm bg-zinc-100 p-2">
                <p className="text-[10px] text-f1-brand">CORRECT</p>
                <p className="text-lg font-bold">
                  {modalData.score}/{modalData.total}
                </p>
              </div>
              <div className="rounded-sm bg-zinc-100 p-2">
                <p className="text-[10px] text-f1-brand">ACCURACY</p>
                <p className="text-lg font-bold">{modalData.accuracy}%</p>
                <p className={cn("text-[10px]", modalData.mistakes > 0 ? "text-f1-wrong" : "text-f1-mute")}>
                  วางผิด {modalData.mistakes} ครั้ง
                </p>
              </div>
            </div>

            <p className="mt-4 text-center font-bold text-f1-brand">ผลตรวจทีละข้อ</p>
            <div className="mt-2 max-h-[40vh] space-y-3 overflow-y-auto pr-1">
              {game.pairs.map((pair) => {
                const w = modalData.wrong.find((x) => x.pairId === pair.id);
                const hasWrongCard = w?.placedCards.some((c) => !c.correct) ?? false;
                return (
                  <div key={pair.id} className="space-y-2 rounded-sm border border-f1-line bg-zinc-100 p-3">
                    <h4 className="font-bold">{pair.promptText || "(ภาพ)"}</h4>
                    {!w ? (
                      <p className="rounded-sm border border-green-200 bg-f1-ok-bg px-2 py-1 text-sm text-f1-ok-ink">
                        <CircleCheck className="inline size-4 align-text-bottom" /> ถูกแล้ว
                      </p>
                    ) : w.placedCards.length > 0 ? (
                      // แสดงการ์ดที่วางไว้ทีละใบ บอกถูก/ผิดเป็นรายใบ ไม่รวมเป็นก้อนเดียว
                      <>
                        <div className="flex flex-wrap gap-1.5">
                          {w.placedCards.map((c, i) => (
                            <span
                              key={i}
                              className={cn(
                                "rounded-sm border px-2 py-1 text-sm",
                                c.correct
                                  ? "border-green-200 bg-f1-ok-bg text-f1-ok-ink"
                                  : "border-red-200 bg-f1-bad-bg text-f1-bad",
                              )}
                            >
                              {c.correct ? <CircleCheck className="inline size-4 align-text-bottom" /> : <CircleX className="inline size-4 align-text-bottom" />} {c.label}
                            </span>
                          ))}
                        </div>
                        {!hasWrongCard && w.missingCount > 0 && (
                          <p className="text-xs text-f1-mute">ถูกหมดแล้ว แต่ยังขาดอีก {w.missingCount} ใบ</p>
                        )}
                        {showAnswerKey && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {w.correctCards.map((label, i) => (
                              <span
                                key={i}
                                className="rounded-sm border border-green-200 bg-f1-ok-bg px-2 py-1 text-sm text-f1-ok-ink"
                              >
                                <CircleCheck className="inline size-4 align-text-bottom" /> {label}
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="rounded-sm border border-f1-line bg-white px-2 py-1 text-sm text-f1-mute">
                        <Circle className="inline size-4 align-text-bottom" /> ยังไม่ได้ใส่คำตอบ
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {modalData.wrong.length > 0 && !showAnswerKey && (
              <Button
                className="f1-font-display mt-4 w-full bg-f1-brand text-white hover:bg-f1-brand-dark"
                onClick={() => setShowAnswerKey(true)}
              >
                <Eye /> เฉลย
              </Button>
            )}

            {/* บนจอ Station ส่งผลแล้วจอเป็นคนไปต่อ: ผ่าน → สถานีถัดไป, ไม่ผ่าน → โหลดเกมใหม่ (docs/STATION_ACTIVITY.md ของ portal) */}
            {resultHandedOff && (
              <p className="mt-4 text-center text-sm font-medium text-f1-mute">
                {lastReportRef.current?.result === "pass"
                  ? "ผ่านแล้ว — จอจะไปสถานีถัดไปเอง"
                  : "จอจะโหลดเกมใหม่ให้ลองอีกครั้ง"}
              </p>
            )}

            <div className="mt-5 flex justify-center gap-2">
              {!embedded && (
                <Button
                  variant="outline"
                  className="border-f1-brand bg-white text-f1-brand hover:bg-f1-brand/10"
                  onClick={resetAll}
                >
                  เล่นใหม่
                </Button>
              )}
              {!modalData.allCorrect && !modalData.isTimeout && !resultHandedOff && (
                <Button className="bg-f1-brand text-white hover:bg-f1-brand-dark" onClick={retryWrongOnly}>
                  เล่นต่อ (เอาการ์ดผิดกลับคลัง)
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
