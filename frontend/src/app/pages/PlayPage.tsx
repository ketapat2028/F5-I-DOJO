import { useEffect, useRef, useState } from "react";
import { ArrowLeftRight, Check, Circle, CircleCheck, CircleX, Eye, Flag, Gauge, Info, Loader2, Plus, Timer, TriangleAlert, Trophy, X } from "lucide-react";
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
};
type PortalStatus = "idle" | "sending" | "sent" | "error";
type PortalReport = { result: PortalResult; score: number };

// portal ไม่ตอบ ack ภายในเวลานี้ = ถือว่ายังไม่ได้บันทึก (PORTAL_INTEGRATION.md ข้อ 2)
const ACK_TIMEOUT_MS = 10_000;
// บนจอ Station ต้องมีเวลาจำกัดเสมอ ไม่งั้นตอบไม่ครบจะไม่มีผล fail ส่งไปที่จอ
const EMBED_DEFAULT_LIMIT = 300;

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

export function PlayPage() {
  const [game, setGame] = useState<Theme | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [chips, setChips] = useState<Chip[]>([]);
  // box id = pair.id เสมอ · value = รายการ chip id ที่วางอยู่ในช่องนี้ (ความจุ = pair.answers.length)
  const [slots, setSlots] = useState<Record<string, string[]>>({});
  const [lockedCorrect, setLockedCorrect] = useState<Set<string>>(new Set());
  // ช่องที่มีการ์ดผิดจริงๆ ปนอยู่ (ไม่ใช่แค่ใส่ยังไม่ครบ) — ใช้ไฮไลต์แดง/เขย่าที่ตัวช่อง
  const [wrongBoxIds, setWrongBoxIds] = useState<Set<string>>(new Set());
  // การ์ดใบไหนบ้างที่ไม่ใช่คำตอบของข้อนั้น — ใช้ขึ้นกากบาทแดงเฉพาะใบที่ผิดจริง
  const [wrongChipIds, setWrongChipIds] = useState<Set<string>>(new Set());
  const [elapsed, setElapsed] = useState(0);
  const [modalData, setModalData] = useState<ModalData | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  // กดช่องว่างที่ยังไม่ได้เลือกการ์ดไว้ล่วงหน้า → เปิด popup นี้ให้เลือกคำตอบจากคลังแล้ววางทันที
  const [pickerBoxId, setPickerBoxId] = useState<string | null>(null);
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

  useEffect(() => {
    setLoadError(null);
    getGame()
      .then((g) => {
        setGame(g);
        setChips(makeChips(g.pairs));
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

  const total = game.pairs.length;
  const filledCount = game.pairs.filter((p) => (slots[p.id]?.length ?? 0) === p.answers.length).length;
  const isAllFilled = filledCount === total;
  // ใส่คำตอบไปแล้วอย่างน้อย 1 ใบ ก็กดตรวจได้ทันที ไม่ต้องรอครบทุกช่อง
  const totalSlots = game.pairs.reduce((sum, p) => sum + p.answers.length, 0);
  const totalPlaced = Object.values(slots).reduce((sum, arr) => sum + arr.length, 0);
  const hasAnyPlaced = totalPlaced > 0;
  const pool = chips.filter((c) => !Object.values(slots).some((arr) => arr.includes(c.id)));
  const limit = effectiveLimit(game, embedded);
  const hasLimit = limit > 0;
  const remaining = hasLimit ? Math.max(0, limit - elapsed) : null;
  const lowTime = remaining !== null && remaining <= 60;
  const locked = phase === "finished" || phase === "timeout";
  // ตอนถูกฝัง: ส่งผลไปแล้ว (กำลังรอ/ได้ ack) → ไม่ให้เล่นต่อเอง รอจอจัดการ
  const resultHandedOff = embedded && (portalStatus === "sending" || portalStatus === "sent");

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
    setSlots({});
    setPickerBoxId(null);
    setLockedCorrect(new Set());
    setWrongBoxIds(new Set());
    setWrongChipIds(new Set());
    setElapsed(0);
    setModalData(null);
    setShowAnswerKey(false);
    setPhase("idle");
  }

  function clearAnswers() {
    setSlots({});
    setLockedCorrect(new Set());
    setWrongBoxIds(new Set());
    setWrongChipIds(new Set());
  }

  // fromBoxId = ลบการ์ดออกจากช่อง (removeChipFromSlot) · targetBoxId = วางการ์ดลงช่อง (pickForBox) — ไม่เกิดพร้อมกัน
  function placeChip(chipId: string, fromBoxId: string | null, targetBoxId: string | null) {
    setSlots((prev) => {
      const next: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(prev)) next[k] = v.filter((id) => id !== chipId);
      if (targetBoxId) {
        const capacity = game?.pairs.find((p) => p.id === targetBoxId)?.answers.length ?? 1;
        const occupants = next[targetBoxId] ?? [];
        if (occupants.length < capacity) next[targetBoxId] = [...occupants, chipId];
      }
      return next;
    });
    setWrongBoxIds((prev) => {
      const next = new Set(prev);
      if (fromBoxId) next.delete(fromBoxId);
      if (targetBoxId) next.delete(targetBoxId);
      return next;
    });
    setWrongChipIds((prev) => {
      if (!prev.has(chipId)) return prev;
      const next = new Set(prev);
      next.delete(chipId);
      return next;
    });
  }

  function handleCheck(isAuto: boolean) {
    if (!game) return;
    if (!isAuto && !hasAnyPlaced) return;
    const newLocked = new Set(lockedCorrect);
    const newWrongIds = new Set<string>();
    const newWrongChipIds = new Set<string>();
    const wrong: WrongItem[] = [];
    for (const pair of game.pairs) {
      const placed = slots[pair.id] ?? [];
      const correctIds = new Set(pair.answers.map((a) => a.id));
      const isCorrect = placed.length === pair.answers.length && placed.every((id) => correctIds.has(id));
      if (isCorrect) {
        newLocked.add(pair.id);
        continue;
      }
      // แยกการ์ดที่ผิดจริง (ไม่ใช่คำตอบของข้อนี้) ออกจากการ์ดที่ถูกแต่ใส่ยังไม่ครบ — ยังไม่ครบไม่เขย่า/ไม่ขึ้นกากบาท ถ้าทุกใบที่ใส่ยังถูกอยู่
      const wrongCardIds = placed.filter((id) => !correctIds.has(id));
      const hasWrongCard = wrongCardIds.length > 0;
      if (hasWrongCard) newWrongIds.add(pair.id);
      wrongCardIds.forEach((id) => newWrongChipIds.add(id));
      wrong.push({
        pairId: pair.id,
        topic: pair.promptText || "(ภาพ)",
        placedCards: placed.map((id) => ({
          label: chipLabel(chips.find((c) => c.id === id)) ?? "?",
          correct: correctIds.has(id),
        })),
        correctCards: pair.answers.map(
          (a) => chipLabel(chips.find((c) => c.id === a.id)) ?? (a.text || "(ภาพ)"),
        ),
        missingCount: pair.answers.length - placed.length,
      });
    }
    setLockedCorrect(newLocked);
    setWrongBoxIds(newWrongIds);
    setWrongChipIds(newWrongChipIds);
    setShowAnswerKey(false);
    const allCorrect = wrong.length === 0;
    setModalData({
      allCorrect,
      isTimeout: isAuto && !allCorrect,
      score: newLocked.size,
      total: game.pairs.length,
      timeUsedSeconds: elapsed,
      wrong,
    });
    // ผิดแต่เวลายังเหลือ = ไม่ส่งผล ให้แก้ต่อจนถูกครบหรือหมดเวลา
    const pct = Math.round((100 * newLocked.size) / game.pairs.length);
    if (allCorrect) {
      setPhase("finished");
      report({ result: "pass", score: pct });
    } else if (isAuto) {
      setPhase("timeout");
      report({ result: "fail", score: pct });
    }
  }

  function retryWrongOnly() {
    setSlots((prev) => {
      const next = { ...prev };
      wrongBoxIds.forEach((boxId) => {
        next[boxId] = [];
      });
      return next;
    });
    setWrongBoxIds(new Set());
    setModalData(null);
    setShowAnswerKey(false);
  }

  // กดช่องว่าง → เปิด popup ให้เลือกคำตอบจากคลังแล้ววางลงช่องนี้ทันที
  function handleSlotClick(boxId: string) {
    if (locked || lockedCorrect.has(boxId)) return;
    startIfIdle();
    setPickerBoxId(boxId);
  }

  function pickForBox(chipId: string) {
    if (!pickerBoxId) return;
    placeChip(chipId, null, pickerBoxId);
    setPickerBoxId(null);
  }

  function removeChipFromSlot(boxId: string, chipId: string) {
    if (locked || lockedCorrect.has(boxId)) return;
    placeChip(chipId, boxId, null);
  }

  // แสดงการ์ดที่วางอยู่ในช่องคำตอบแล้ว (อ่านอย่างเดียว — เอาออกผ่านปุ่ม ✕ ของช่องเท่านั้น)
  // compact = ช่องแคบ (คำถามที่มีคำตอบหลายใบ) → ตัวหนังสือเล็กลงไม่ให้ล้นช่อง
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

  // การ์ดคำถาม: แถบเลขข้อสีน้ำเงินด้านซ้าย · รูป (ถ้ามี) ไม่ยืด ไม่มีแถบดำทับ · ข้อความอยู่ข้างรูป
  function renderQuestion(pair: MatchPair, idx: number) {
    const hasImg = pair.promptType !== "text" && Boolean(pair.promptImage);
    const hasText = pair.promptType !== "image" && Boolean(pair.promptText);
    return (
      <div className="flex h-full w-full min-h-0 min-w-0 overflow-hidden rounded-xl border border-f1-line bg-white shadow-sm">
        <span className="f1-font-mono flex w-6 shrink-0 items-center justify-center bg-f1-brand text-xs font-bold text-white sm:w-8 sm:text-sm lg:w-10 lg:text-lg">
          {idx + 1}
        </span>
        {/* มือถือ: รูปอยู่บน ข้อความอยู่ล่าง (ช่องแคบ) · sm ขึ้นไป: รูปซ้าย ข้อความขวา */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-1 p-1 sm:flex-row sm:gap-3 sm:p-2 lg:gap-5">
          {hasImg && (
            <img
              src={pair.promptImage}
              alt={pair.promptText}
              draggable={false}
              className={cn(
                "min-h-0 w-full min-w-0 flex-1 rounded-md object-contain sm:h-full sm:flex-none",
                hasText && "sm:w-auto sm:max-w-[60%]",
              )}
            />
          )}
          {hasText && (
            <span className="f1-font-display line-clamp-1 w-full min-w-0 shrink-0 px-1 text-center text-xs font-bold leading-tight text-f1-ink sm:line-clamp-3 sm:w-auto sm:flex-1 sm:text-left sm:text-base lg:text-xl 2xl:text-2xl">
              {pair.promptText}
            </span>
          )}
        </div>
      </div>
    );
  }

  const sectionTitle = "f1-font-display text-lg font-bold tracking-wide text-f1-ink fit:text-sm";
  // ช่องคำถามกับช่องคำตอบกว้างเท่ากัน (1fr | ลูกศร | 1fr) และสูงเท่าแถว — ทุกแถวสูงเท่ากันจาก auto-rows ของรายการ
  const rowGrid = "grid min-h-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] items-stretch gap-2 sm:gap-4 lg:gap-6";
  const tier = modalData ? resultTier(modalData.score, modalData.total) : null;
  const howToList = (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {(
        [
          ["L", "ซ้าย = คำถาม (คงที่ อ่านอย่างเดียว)"],
          ["R", "ขวา = ช่องคำตอบ (วางคำตอบที่นี่)"],
          ["1", "คลิกช่องว่างทางขวาที่ต้องการวาง"],
          ["2", "เลือกคำตอบจาก popup ที่เปิดขึ้นมา — คำตอบจะถูกวางลงช่องนั้นทันที"],
          ["3", "กด ✕ ที่มุมการ์ดเพื่อเอาคำตอบออก แล้วเลือกใหม่ได้"],
          ["4", "ใส่คำตอบอย่างน้อย 1 ช่อง แล้วกด ตรวจสอบคำตอบ (CHECK) ได้เลย — ตรวจซ้ำได้เรื่อยๆ"],
        ] as const
      ).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="f1-font-mono flex h-6 w-6 items-center justify-center rounded-sm bg-f1-brand text-xs font-bold">
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
    <div className={cn("f1-paper-bg flex h-dvh flex-col overflow-hidden", embedded && "pb-28")}>
      <F1Header />
      <main className="flex min-h-0 w-full flex-1 flex-col gap-2 px-3 py-2 sm:gap-3 sm:px-6 lg:px-12 fit:gap-2 fit:py-2">
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 lg:flex-nowrap">
          <div className="min-w-0 flex-1 lg:flex-none">
            <GameTitle name={game.name} />
            <p className="f1-font-display mt-1 hidden text-sm font-medium tracking-widest text-f1-brand sm:block fit:mt-0 fit:text-xs">
              LEFT Q • RIGHT A — QUESTION LEFT • ANSWER RIGHT • MATCH
            </p>
          </div>

          <div className="order-last flex w-full flex-col gap-1.5 lg:order-none lg:w-auto lg:flex-1">
            <div className="f1-font-mono flex flex-wrap items-center gap-x-4 gap-y-1 rounded-sm border-2 border-f1-brand bg-f1-ink px-3 py-1.5 sm:px-4 sm:py-2">
              <div className="flex items-baseline gap-2">
                <span className="flex items-center gap-1 text-xs text-zinc-400">
                  <Timer className="size-3.5" /> TIME
                </span>
                <span
                  className={cn(
                    "text-2xl font-bold text-white",
                    lowTime && phase === "running" && "f1-timer-blink text-f1-wrong-bright",
                  )}
                >
                  {remaining !== null ? formatTime(remaining) : formatTime(elapsed)}
                </span>
              </div>
              <p className="f1-font-display text-xs text-zinc-300 sm:text-sm">
                · สถานะ:{" "}
                <strong className="text-white">
                  {filledCount}/{total} ช่อง • {pool.length} ตัวเลือกเหลือ
                </strong>
              </p>
            </div>

            {remaining !== null && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-300 sm:h-2">
                <div
                  className={cn(
                    "h-full rounded-full bg-f1-brand transition-all",
                    lowTime && phase === "running" && "f1-timer-blink",
                  )}
                  style={{ width: `${(remaining / limit) * 100}%` }}
                />
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1">
            {!locked && (
              <p className="f1-font-display hidden text-right text-xs text-f1-brand sm:block">
                {isAllFilled
                  ? "ครบแล้ว! กดตรวจสอบได้เลย"
                  : hasAnyPlaced
                    ? `กดตรวจสอบได้เลย (วางแล้ว ${totalPlaced}/${totalSlots} ใบ)`
                    : <><TriangleAlert className="inline size-4 align-text-bottom" /> ยังไม่ได้ใส่คำตอบ</>}
              </p>
            )}
            <div className="flex shrink-0 gap-2">
              {!locked && (
                <Button
                  disabled={!hasAnyPlaced}
                  onClick={() => handleCheck(false)}
                  className={cn(
                    "f1-font-display",
                    hasAnyPlaced ? "f1-glow bg-f1-brand text-white hover:bg-f1-brand-dark" : "bg-zinc-200 text-zinc-500",
                  )}
                >
                  <Flag />
                  <span>
                    ตรวจสอบ<span className="hidden sm:inline">คำตอบ (CHECK)</span>
                  </span>
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
        </div>

        <div className="f1-font-display grid shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 px-1 text-xs font-medium tracking-wide text-f1-brand sm:gap-4 lg:gap-6">
          <span># · คำถาม (ซ้าย)</span>
          <ArrowLeftRight className="size-4" />
          <span className="text-center">คำตอบ (ขวา)</span>
        </div>

        {/* ทุกแถวสูงเท่ากันและแบ่งพื้นที่ที่เหลือของจอ · เตี้ยกว่า 6rem (มือถือ) / 4.5rem จะเลื่อนในกล่องนี้แทน */}
        {/* เว้นขอบ px-3/py-3 ไว้ให้ปุ่ม ✕ และป้าย ✓/✗ ที่ยื่นออกนอกมุมการ์ด ไม่ถูก overflow ตัด */}
        <div className="-mx-3 grid min-h-0 flex-1 auto-rows-[minmax(6rem,1fr)] gap-2 sm:auto-rows-[minmax(4.5rem,1fr)] overflow-y-auto px-3 py-3 sm:gap-3 fit:gap-2">
          {game.pairs.map((pair, idx) => {
            const occupantIds = slots[pair.id] ?? [];
            const occupantChips = occupantIds
              .map((id) => chips.find((c) => c.id === id))
              .filter((c): c is Chip => Boolean(c));
            const capacity = pair.answers.length;
            const isMulti = capacity > 1;
            const isLocked = lockedCorrect.has(pair.id);
            const isWrong = wrongBoxIds.has(pair.id);
            return (
              <div key={pair.id} className={rowGrid}>
                {renderQuestion(pair, idx)}
                <ArrowLeftRight className="size-4 self-center text-f1-brand" />
                {!isMulti ? (
                  <div className="relative h-full min-h-0 min-w-0">
                    <div
                      data-dropbox-id={pair.id}
                      onClick={() => {
                        if (!occupantChips[0]) handleSlotClick(pair.id);
                      }}
                      className={cn(
                        "flex h-full w-full min-h-0 items-center justify-center rounded-xl border-2 border-dashed border-f1-line-strong bg-white/70 text-sm transition-colors hover:border-f1-brand hover:bg-f1-brand/5",
                        !occupantChips[0] && "cursor-pointer",
                        occupantChips.length > 0 && "border-solid border-f1-brand bg-white shadow-sm hover:bg-white",
                        isLocked && "f1-correct-bounce border-solid border-[#15803D] bg-f1-ok-bg",
                        !isLocked && isWrong && "f1-shake border-solid border-f1-wrong bg-f1-wrong/10",
                      )}
                    >
                      {occupantChips[0] ? (
                        renderChip(occupantChips[0])
                      ) : (
                        <span className="flex items-center gap-1.5 text-xs text-f1-mute">
                          <Plus className="size-4" /> เลือกคำตอบ
                        </span>
                      )}
                    </div>
                    {occupantChips[0] && !isLocked && !locked && (
                      <button
                        type="button"
                        onClick={() => removeChipFromSlot(pair.id, occupantChips[0].id)}
                        className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-f1-brand text-xs font-bold text-white"
                        aria-label="ลบการ์ดออกจากช่อง"
                      >
                        <X className="size-3.5" strokeWidth={3} />
                      </button>
                    )}
                    {isLocked && (
                      <div className="f1-checkered-flash pointer-events-none absolute inset-0 rounded-xl" />
                    )}
                    {!isLocked && isWrong && (
                      <div className="f1-redflag-flash pointer-events-none absolute inset-0 rounded-xl" />
                    )}
                    {occupantChips[0] && isLocked && (
                      <span className="absolute -bottom-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-[#15803D] text-sm font-bold text-white shadow">
                        <Check className="size-4" strokeWidth={3} />
                      </span>
                    )}
                    {occupantChips[0] && !isLocked && isWrong && (
                      <span className="absolute -bottom-2 -right-2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-f1-wrong text-sm font-bold text-white shadow">
                        <X className="size-4" strokeWidth={3} />
                      </span>
                    )}
                  </div>
                ) : (
                  // 1 คำถามมีหลายคำตอบ — แสดงเป็นช่องแยกต่อการ์ด (ไม่ใช่กล่องเดียวรวมกัน) จำนวนช่อง = จำนวนคำตอบที่ต้องการ
                  // ทุกช่องใช้ data-dropbox-id เดียวกัน (= pair.id) เพราะวางการ์ดถูกช่องไหนก็ได้ในแถวเดียวกัน
                  <div
                    className={cn(
                      "relative grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)] gap-2 rounded-xl transition-colors",
                      isLocked && "f1-correct-bounce",
                      !isLocked && isWrong && "f1-shake",
                    )}
                    style={{ gridTemplateColumns: `repeat(${capacity}, minmax(0, 1fr))` }}
                  >
                    {Array.from({ length: capacity }, (_, i) => {
                      const chip = occupantChips[i];
                      const isWrongCard = Boolean(chip) && wrongChipIds.has(chip!.id);
                      return (
                        <div
                          key={i}
                          data-dropbox-id={pair.id}
                          onClick={() => {
                            if (!chip) handleSlotClick(pair.id);
                          }}
                          className={cn(
                            "relative flex h-full min-h-0 min-w-0 items-center justify-center rounded-lg border-2 border-dashed border-f1-line-strong bg-white/70 text-sm transition-colors hover:border-f1-brand hover:bg-f1-brand/5",
                            !chip && "cursor-pointer",
                            chip && "border-solid border-f1-brand bg-white shadow-sm hover:bg-white",
                            isLocked && "border-solid border-[#15803D] bg-f1-ok-bg",
                            isWrongCard && "border-solid border-f1-wrong bg-f1-wrong/10",
                          )}
                        >
                          {chip ? (
                            renderChip(chip, capacity > 2)
                          ) : (
                            <Plus className="size-5 text-f1-line-strong" aria-label="เลือกคำตอบ" />
                          )}
                          {chip && !isLocked && !locked && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeChipFromSlot(pair.id, chip.id);
                              }}
                              className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-f1-brand text-[10px] font-bold text-white"
                              aria-label="ลบการ์ดออกจากช่อง"
                            >
                              <X className="size-3" strokeWidth={3} />
                            </button>
                          )}
                          {chip && isLocked && (
                            <span className="absolute -bottom-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-[#15803D] text-xs font-bold text-white shadow">
                              <Check className="size-3.5" strokeWidth={3} />
                            </span>
                          )}
                          {isWrongCard && (
                            <span className="absolute -bottom-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-f1-wrong text-xs font-bold text-white shadow">
                              <X className="size-3.5" strokeWidth={3} />
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {isLocked && (
                      <div className="f1-checkered-flash pointer-events-none absolute inset-0 rounded-xl" />
                    )}
                    {!isLocked && isWrong && (
                      <div className="f1-redflag-flash pointer-events-none absolute inset-0 rounded-xl" />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center gap-4">
        <h2 className={cn(sectionTitle, "hidden items-center gap-2 sm:flex")}>
          <Gauge className="size-5" /> RACE CONTROL
        </h2>

        <div className="flex flex-1 flex-wrap justify-end gap-2">
          {!locked && (
            <Button
              variant="outline"
              className="f1-font-display border-f1-line-strong bg-white text-f1-ink hover:bg-zinc-100"
              onClick={clearAnswers}
            >
              ล้างคำตอบ
            </Button>
          )}
          {/* บนจอ Station รีเซ็ตแล้วเวลาเริ่มใหม่ = เลี่ยงการหมดเวลา จึงไม่ให้กด */}
          {!embedded && (
            <Button
              variant="outline"
              className="f1-font-display border-f1-brand bg-white text-f1-brand hover:bg-f1-brand/10"
              onClick={resetAll}
            >
              รีเซ็ตทั้งหมด
            </Button>
          )}
        </div>
        </div>

        <div className="f1-font-display hidden shrink-0 justify-between gap-6 overflow-hidden whitespace-nowrap text-[10px] text-f1-mute md:flex">
          <p>* ซ้าย = คำถามคงที่ • ขวา = คำตอบ • คลิกช่องว่างเพื่อเลือกคำตอบ</p>
          <p>I-DOJO - PIT 5 DOMINO IMPACT • LEFT QUESTION • RIGHT ANSWER • BLUE #1B4FA0 • WHITE • GREEN = CORRECT • RED = WRONG</p>
        </div>
      </main>

      {showHelp && (
        <div
          className="fixed inset-0 z-[65] flex items-center justify-center overflow-y-auto bg-black/60 p-4"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="f1-font-display relative my-auto w-full max-w-xl rounded-sm border-4 border-f1-brand bg-white p-6 text-sm text-f1-ink"
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
            <h2 className="mb-3 font-bold text-f1-brand">วิธีเล่น (แบบคลิก)</h2>
            {howToList}
          </div>
        </div>
      )}

      {pickerBoxId && (
        <div
          className="f1-backdrop-fade fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/70 p-4"
          onClick={() => setPickerBoxId(null)}
        >
          <div
            className="f1-font-display f1-modal-pop relative my-auto w-full max-w-3xl rounded-sm border-4 border-f1-brand bg-white p-4 text-f1-ink"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPickerBoxId(null)}
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-f1-brand font-bold text-white"
              aria-label="ปิด"
            >
              <X className="size-5" strokeWidth={3} />
            </button>
            <h3 className="mb-3 text-center text-lg font-bold text-f1-brand">เลือกคำตอบใส่ช่องนี้</h3>
            {pool.length === 0 ? (
              <p className="py-6 text-center text-sm text-[#8B8B95]">คลังว่างแล้ว — ไม่มีคำตอบให้เลือก</p>
            ) : (
              <div className="grid max-h-[65vh] grid-cols-2 gap-3 overflow-y-auto p-1 sm:grid-cols-3">
                {pool.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => pickForBox(chip.id)}
                    className="flex flex-col overflow-hidden rounded-md border-2 border-f1-line text-left hover:border-f1-brand"
                  >
                    {chip.image && (
                      <img
                        src={chip.image}
                        alt=""
                        draggable={false}
                        className="aspect-video w-full bg-zinc-100 object-contain"
                      />
                    )}
                    <span className="p-2 text-sm font-bold">
                      <span className="mr-1 text-f1-brand">{chip.letter}.</span>
                      {chip.text}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {modalData?.allCorrect && <Confetti />}

      {modalData && tier && (
        <div
          className={cn(
            "fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 p-4",
            embedded && "pb-28",
          )}
        >
          <div className="f1-font-display relative my-auto w-full max-w-lg rounded-sm border-4 border-f1-brand bg-white p-6 text-f1-ink">
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
                <p className="text-lg font-bold">{Math.round((modalData.score / modalData.total) * 100)}%</p>
              </div>
            </div>

            <p className="mt-4 text-center font-bold text-f1-brand">ผลตรวจทีละข้อ</p>
            <div className="mt-2 max-h-[40vh] space-y-3 overflow-y-auto pr-1">
              {game.pairs.map((pair) => {
                const isCorrect = lockedCorrect.has(pair.id);
                const w = modalData.wrong.find((x) => x.pairId === pair.id);
                const hasWrongCard = w?.placedCards.some((c) => !c.correct) ?? false;
                return (
                  <div key={pair.id} className="space-y-2 rounded-sm border border-f1-line bg-zinc-100 p-3">
                    <h4 className="font-bold">{pair.promptText || "(ภาพ)"}</h4>
                    {isCorrect ? (
                      <p className="rounded-sm border border-green-200 bg-f1-ok-bg px-2 py-1 text-sm text-f1-ok-ink">
                        <CircleCheck className="inline size-4 align-text-bottom" /> ถูกแล้ว
                      </p>
                    ) : w && w.placedCards.length > 0 ? (
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
                          <p className="text-xs text-amber-700"><TriangleAlert className="inline size-3.5 align-text-bottom" /> ถูกหมดแล้ว แต่ยังขาดอีก {w.missingCount} ใบ</p>
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
                  ลองใหม่เฉพาะข้อผิด
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
