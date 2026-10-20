import { useEffect, useRef, useState } from "react";
import { Confetti } from "../components/Confetti";
import { F1Header } from "../components/F1Header";
import { isYouTubeUrl, VideoPlayer } from "../components/VideoPlayer";
import { Button } from "../components/ui/button";
import { cn } from "../components/ui/utils";
import type { MatchPair, PromptType, Theme } from "../types/theme";
import { getGame, NoGameError } from "../utils/gameStore";
import { forwardKeys, isEmbedded, listenPortal, sendResult, type PortalAck, type PortalResult } from "../utils/portalBridge";

type Phase = "idle" | "running" | "finished" | "timeout";
type Chip = { id: string; text: string; letter: string; type: PromptType; image?: string };
type DragInfo = {
  chipId: string;
  fromBoxId: string | null;
  startX: number;
  startY: number;
  width: number;
  height: number;
  dx: number;
  dy: number;
  active: boolean;
};
type WrongItem = {
  pairId: string;
  topic: string;
  yourAnswer: string | null;
  correctAnswer: string;
  hasVideo: boolean;
};
type ModalData = {
  allCorrect: boolean;
  isTimeout: boolean;
  score: number;
  total: number;
  timeUsedSeconds: number;
  wrong: WrongItem[];
};
type VideoView = { pairIds: string[]; index: number };
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

const DRAG_THRESHOLD = 6;
const TYPE_BADGE: Record<PromptType, string> = { text: "TEXT", image: "IMAGE", mixed: "MIXED" };

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ตัวอักษร A, B, C... ติดตามตำแหน่งหลังสลับ เพื่อไม่ให้ลำดับตัวอักษรเฉลยคำตอบ
function makeChips(pairs: MatchPair[]): Chip[] {
  return shuffle(
    pairs.map((p) => ({ id: p.id, text: p.answerText, type: p.answerType, image: p.answerImage })),
  ).map((c, i) => ({ ...c, letter: String.fromCharCode(65 + i) }));
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
  if (score === total) return { title: "PERFECT LAP! 🏆", sub: "รถแข่งพุ่งผ่านธงตาหมากรุก! 🏁" };
  if (score * 8 >= total * 3) return { title: "PODIUM FINISH!" };
  return { title: "KEEP PUSHING!" };
}

function GameTitle({ name }: { name: string }) {
  const m = name.match(/^(.*\S)\s+RED$/);
  return (
    <h1 className="f1-font-display text-2xl font-bold text-f1-ink">
      🏁 {m ? m[1] : name}
      {m && <span className="text-[#DC0000]"> RED</span>}
    </h1>
  );
}

export function PlayPage() {
  const [game, setGame] = useState<Theme | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [chips, setChips] = useState<Chip[]>([]);
  const [slots, setSlots] = useState<Record<string, string | null>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lockedCorrect, setLockedCorrect] = useState<Set<string>>(new Set());
  const [wrongBoxIds, setWrongBoxIds] = useState<Set<string>>(new Set());
  const [elapsed, setElapsed] = useState(0);
  const [hoverBoxId, setHoverBoxId] = useState<string | null>(null);
  const [modalData, setModalData] = useState<ModalData | null>(null);
  const [videoView, setVideoView] = useState<VideoView | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [portalStatus, setPortalStatus] = useState<PortalStatus>("idle");
  const [portalMsg, setPortalMsg] = useState<string | null>(null);

  const dragRef = useRef<DragInfo | null>(null);
  const justDraggedRef = useRef(false);
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
        <main className="f1-font-display mx-auto max-w-3xl space-y-3 p-6 text-f1-red">
          <p>{loadError ?? "กำลังโหลด..."}</p>
          {loadError && (
            <Button className="bg-[#DC0000] text-white hover:bg-[#b00000]" onClick={() => setLoadAttempt((n) => n + 1)}>
              ลองใหม่
            </Button>
          )}
        </main>
      </div>
    );
  }

  const total = game.pairs.length;
  const filledCount = game.pairs.filter((p) => slots[p.id]).length;
  const isAllFilled = filledCount === total;
  const pool = chips.filter((c) => !Object.values(slots).some((v) => v === c.id));
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
    setSelectedId(null);
    setLockedCorrect(new Set());
    setWrongBoxIds(new Set());
    setElapsed(0);
    setModalData(null);
    setVideoView(null);
    setPhase("idle");
  }

  function clearAnswers() {
    setSlots({});
    setSelectedId(null);
    setLockedCorrect(new Set());
    setWrongBoxIds(new Set());
  }

  function placeChip(chipId: string, fromBoxId: string | null, targetBoxId: string | null) {
    setSlots((prev) => {
      const next = { ...prev };
      if (fromBoxId) next[fromBoxId] = null;
      if (targetBoxId) {
        const occupant = next[targetBoxId];
        if (occupant && occupant !== chipId && fromBoxId) {
          next[fromBoxId] = occupant;
        }
        next[targetBoxId] = chipId;
      }
      return next;
    });
    setWrongBoxIds((prev) => {
      const next = new Set(prev);
      if (fromBoxId) next.delete(fromBoxId);
      if (targetBoxId) next.delete(targetBoxId);
      return next;
    });
  }

  function handleCheck(isAuto: boolean) {
    if (!game) return;
    if (!isAuto && !isAllFilled) return;
    const newLocked = new Set(lockedCorrect);
    const newWrongIds = new Set<string>();
    const wrong: WrongItem[] = [];
    for (const pair of game.pairs) {
      const chipId = slots[pair.id];
      if (chipId === pair.id) {
        newLocked.add(pair.id);
        continue;
      }
      if (chipId) newWrongIds.add(pair.id);
      wrong.push({
        pairId: pair.id,
        topic: pair.promptText || "(ภาพ)",
        yourAnswer: chipId ? chipLabel(chips.find((c) => c.id === chipId)) : null,
        correctAnswer: chipLabel(chips.find((c) => c.id === pair.id)) ?? (pair.answerText || "(ภาพ)"),
        hasVideo: Boolean(pair.videoUrl) && !isYouTubeUrl(pair.videoUrl),
      });
    }
    setLockedCorrect(newLocked);
    setWrongBoxIds(newWrongIds);
    setSelectedId(null);
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
        next[boxId] = null;
      });
      return next;
    });
    setWrongBoxIds(new Set());
    setModalData(null);
    setVideoView(null);
  }

  function openVideo(pairId: string) {
    if (!modalData) return;
    const pairIds = modalData.wrong.filter((w) => w.hasVideo).map((w) => w.pairId);
    setVideoView({ pairIds, index: Math.max(0, pairIds.indexOf(pairId)) });
  }

  // ===== โหมดคลิก =====
  function handleBankChipClick(chip: Chip) {
    if (locked || justDraggedRef.current) return;
    startIfIdle();
    setSelectedId((prev) => (prev === chip.id ? null : chip.id));
  }

  function handleSlotClick(boxId: string) {
    if (locked || justDraggedRef.current || lockedCorrect.has(boxId) || !selectedId) return;
    placeChip(selectedId, null, boxId);
    setSelectedId(null);
  }

  function removeFromSlot(boxId: string) {
    if (locked || lockedCorrect.has(boxId)) return;
    placeChip(slots[boxId] as string, boxId, null);
  }

  // ===== โหมดลากวาง (เริ่มลากเมื่อขยับเกินระยะที่กำหนด ไม่งั้นนับเป็นการคลิก) =====
  function findBoxOf(chipId: string): string | null {
    for (const [boxId, occupantId] of Object.entries(slots)) {
      if (occupantId === chipId) return boxId;
    }
    return null;
  }

  function handleChipPointerDown(e: React.PointerEvent<HTMLDivElement>, chip: Chip) {
    if (locked) return;
    const fromBoxId = findBoxOf(chip.id);
    if (fromBoxId && lockedCorrect.has(fromBoxId)) return;
    // ล็อกเมาส์/นิ้วไว้กับการ์ดตั้งแต่ตอนกด ไม่งั้นลากเร็วๆ แล้วเหตุการณ์ขยับจะไม่ถึงการ์ด
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    dragRef.current = {
      chipId: chip.id,
      fromBoxId,
      startX: e.clientX,
      startY: e.clientY,
      width: rect.width,
      height: rect.height,
      dx: e.clientX - rect.left,
      dy: e.clientY - rect.top,
      active: false,
    };
  }

  function handleChipPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = dragRef.current;
    if (!d) return;
    const el = e.currentTarget;
    if (!d.active) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
      d.active = true;
      startIfIdle();
      el.style.position = "fixed";
      el.style.width = `${d.width}px`;
      el.style.height = `${d.height}px`;
      el.style.zIndex = "50";
      el.style.pointerEvents = "none";
      el.classList.add("f1-dragging");
    }
    el.style.left = `${e.clientX - d.dx}px`;
    el.style.top = `${e.clientY - d.dy}px`;
    const target = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-dropbox-id]");
    const boxId = target?.dataset.dropboxId ?? null;
    setHoverBoxId(boxId && lockedCorrect.has(boxId) ? null : boxId);
  }

  function resetChipStyle(el: HTMLDivElement) {
    el.style.position = "";
    el.style.left = "";
    el.style.top = "";
    el.style.width = "";
    el.style.height = "";
    el.style.zIndex = "";
    el.style.pointerEvents = "";
    el.classList.remove("f1-dragging");
  }

  function finishDrag() {
    justDraggedRef.current = true;
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 0);
  }

  function handleChipPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag || !drag.active) return;
    el.releasePointerCapture(e.pointerId);
    resetChipStyle(el);
    setHoverBoxId(null);
    finishDrag();
    const target = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest<HTMLElement>("[data-dropbox-id]");
    const rawTarget = target?.dataset.dropboxId ?? null;
    const targetBoxId = rawTarget && !lockedCorrect.has(rawTarget) ? rawTarget : null;
    placeChip(drag.chipId, drag.fromBoxId, targetBoxId);
    setSelectedId(null);
  }

  function handleChipPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.active) {
      resetChipStyle(e.currentTarget);
      finishDrag();
    }
    setHoverBoxId(null);
  }

  function renderChip(chip: Chip, inSlot = false) {
    const hasImg = chip.type !== "text" && Boolean(chip.image);
    const captionClass = chip.type === "image" ? "text-xs xl:text-sm" : "";
    const isSelected = !inSlot && selectedId === chip.id;
    return (
      <div
        key={chip.id}
        data-chip-id={chip.id}
        onPointerDown={(e) => handleChipPointerDown(e, chip)}
        onPointerMove={handleChipPointerMove}
        onPointerUp={handleChipPointerUp}
        onPointerCancel={handleChipPointerCancel}
        onClick={inSlot ? undefined : () => handleBankChipClick(chip)}
        className={cn(
          "f1-font-display touch-none select-none border-2 font-medium text-f1-ink",
          inSlot
            ? "border-transparent bg-transparent"
            : isSelected
              ? "border-f1-ink bg-f1-card shadow-[0_0_0_3px_rgba(220,0,0,0.55),0_0_16px_2px_rgba(220,0,0,0.35)]"
              : "border-[#DC0000] bg-f1-card shadow-[0_0_0_1px_rgba(220,0,0,0.3)]",
          inSlot
            ? "flex h-full w-full min-h-0 cursor-grab flex-col items-center justify-center gap-1 rounded-md p-2 fit:p-1 text-center text-sm active:cursor-grabbing sm:text-base xl:text-xl fit:text-xs fit:xl:text-sm fit:2xl:text-lg"
            : "flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm lg:px-5 lg:py-3 lg:text-lg fit:px-3 fit:py-1.5 fit:text-sm fit:2xl:text-base",
        )}
      >
        {hasImg && (
          <img
            src={chip.image}
            alt=""
            draggable={false}
            className={inSlot ? "min-h-0 w-full flex-1 object-contain" : "h-12 w-16 object-contain lg:h-16 lg:w-24 fit:h-8 fit:w-12 fit:2xl:h-10 fit:2xl:w-16"}
          />
        )}
        <span className={cn("leading-snug", captionClass)}>
          <span className="mr-1 text-f1-red">{chip.letter}.</span>
          {chip.text}
        </span>
      </div>
    );
  }

  function renderQuestion(pair: MatchPair, idx: number) {
    const hasImg = pair.promptType !== "text" && Boolean(pair.promptImage);
    if (hasImg) {
      return (
        <div className="relative flex min-w-0 aspect-[3/1] overflow-hidden rounded-sm border-2 border-f1-line border-l-[6px] border-l-[#DC0000] bg-zinc-200 shadow-sm fit:aspect-auto fit:h-full fit:min-h-0 fit:flex-1">
          <img
            src={pair.promptImage}
            alt={pair.promptText}
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
          />
          <span className="f1-font-mono absolute left-2 top-2 rounded-sm bg-white/90 px-1.5 py-0.5 text-xs font-bold text-f1-red lg:text-sm">
            {idx + 1}
          </span>
          <span className="f1-font-mono absolute right-2 top-2 rounded-sm border border-f1-line bg-white/90 px-1.5 py-0.5 text-[10px] text-f1-ink-2">
            {TYPE_BADGE[pair.promptType]}
          </span>
          {pair.promptText && (
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-3 pb-2 pt-8 fit:pt-5">
              <span className="f1-font-display break-words text-base font-bold leading-tight text-white lg:text-xl fit:text-sm fit:2xl:text-xl">
                {pair.promptText}
              </span>
            </div>
          )}
        </div>
      );
    }
    return (
      <div className="relative flex min-w-0 items-center gap-3 rounded-sm border-2 border-f1-line border-l-[6px] border-l-[#DC0000] bg-white p-3 shadow-sm lg:gap-4 lg:p-5 fit:h-full fit:min-h-0 fit:flex-1 fit:overflow-hidden fit:p-2 fit:2xl:p-4">
        <span className="f1-font-mono text-xs text-f1-red lg:text-base fit:shrink-0">{idx + 1}</span>
        <span className="f1-font-mono absolute right-2 top-2 rounded-sm border border-f1-line px-1.5 py-0.5 text-[10px] text-f1-red">
          {TYPE_BADGE[pair.promptType]}
        </span>
        <span className="f1-font-display min-w-0 flex-1 break-words font-bold text-f1-ink lg:text-2xl fit:text-lg fit:2xl:text-2xl">
          {pair.promptText}
        </span>
      </div>
    );
  }

  const videoPair = videoView ? game.pairs.find((p) => p.id === videoView.pairIds[videoView.index]) : undefined;
  const hasNextVideo = videoView ? videoView.index < videoView.pairIds.length - 1 : false;
  const sectionTitle = "f1-font-display text-lg font-bold tracking-wide text-f1-ink fit:text-sm";
  const rowGrid =
    "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-3 lg:gap-6 fit:flex fit:h-full fit:min-h-0 fit:gap-3";
  const tier = modalData ? resultTier(modalData.score, modalData.total) : null;
  const howToList = (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {(
        [
          ["L", "ซ้าย = คำถาม (คงที่ อ่านอย่างเดียว)"],
          ["R", "ขวา = ช่องคำตอบ (วางคำตอบที่นี่)"],
          ["1", "คลิกเลือกคำตอบใน คลังคำตอบ • PIT BANK (การ์ดที่เลือกจะมีขอบสีเหลือง)"],
          ["2", "คลิกช่องคำตอบทางขวาที่ต้องการวาง (หรือลากการ์ดไปวางก็ได้)"],
          ["3", "คลิกการ์ดเดิมซ้ำเพื่อยกเลิก • คลิกช่องที่มีคำตอบแล้วเพื่อแทนที่ • กด ✕ เพื่อเอาคำตอบออก"],
          ["4", "ใส่ให้ครบทุกช่อง แล้วกด ตรวจสอบคำตอบ"],
        ] as const
      ).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="f1-font-mono flex h-6 w-6 items-center justify-center rounded-sm bg-[#DC0000] text-xs font-bold">
            {k}
          </dt>
          <dd className="self-center">{v}</dd>
        </div>
      ))}
    </dl>
  );

  return (
    // ตอนถูกฝัง portal วางปุ่ม "ผ่านสถานี" ทับขอบล่าง ~90px จึงเว้นที่ไว้
    <div
      className={cn(
        "f1-paper-bg min-h-screen fit:flex fit:h-dvh fit:flex-col fit:overflow-y-auto fit:pb-0",
        embedded ? "pb-28" : "pb-16",
      )}
    >
      <F1Header />
      <main className="flex w-full flex-col gap-4 px-6 py-6 lg:px-12 fit:min-h-0 fit:flex-1 fit:gap-2 fit:px-8 fit:py-2">
        <div className="flex flex-col gap-4 fit:flex-row fit:items-center fit:gap-4">
          <div className="fit:shrink-0">
            <GameTitle name={game.name} />
            <p className="f1-font-display mt-1 text-sm font-medium tracking-widest text-f1-red fit:mt-0 fit:text-xs">
              LEFT Q • RIGHT A — QUESTION LEFT • ANSWER RIGHT • MATCH
            </p>
          </div>

          <div className="flex flex-col gap-2 fit:flex-1">
            <div className="f1-font-mono flex flex-wrap items-center gap-x-4 gap-y-1 rounded-sm border-2 border-[#DC0000] bg-f1-ink px-4 py-3 fit:py-1.5">
              <div className="flex items-baseline gap-2">
                <span className="text-xs text-zinc-400">⏱ TIME</span>
                <span
                  className={cn(
                    "text-2xl font-bold text-white",
                    lowTime && phase === "running" && "f1-timer-blink text-f1-red-bright",
                  )}
                >
                  {remaining !== null ? formatTime(remaining) : formatTime(elapsed)}
                </span>
              </div>
              <p className="f1-font-display text-sm text-zinc-300">
                · สถานะ:{" "}
                <strong className="text-white">
                  {filledCount}/{total} ช่อง • {pool.length} ตัวเลือกเหลือ
                </strong>
              </p>
            </div>

            {remaining !== null && (
              <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-300">
                <div
                  className={cn(
                    "h-full rounded-full bg-[#DC0000] transition-all",
                    lowTime && phase === "running" && "f1-timer-blink",
                  )}
                  style={{ width: `${(remaining / limit) * 100}%` }}
                />
              </div>
            )}
          </div>

          <Button
            variant="outline"
            onClick={() => setShowHelp(true)}
            className="f1-font-display hidden shrink-0 border-f1-ink bg-white text-f1-ink hover:bg-zinc-100 fit:inline-flex"
          >
            📋 วิธีเล่น
          </Button>
        </div>

        <div className="f1-font-display rounded-sm border border-f1-line bg-white p-4 text-sm text-f1-ink fit:hidden">
          <h2 className="mb-2 font-bold text-f1-red">📋 วิธีเล่น (แบบคลิก)</h2>
          {howToList}
        </div>

        <h2 className={sectionTitle}>📝 คำถาม • QUESTION ⟷ ✅ คำตอบ • ANSWER</h2>

        <div className="grid gap-x-12 gap-y-4 xl:grid-cols-2 fit:min-h-0 fit:max-h-[calc(0.675*(100vw_-_88px)_+_24px)] fit:flex-1 fit:grid-cols-2 fit:grid-rows-4 fit:gap-x-6 fit:gap-y-2">
          {[0, 1].map((n) => (
            <div
              key={n}
              className={cn(
                "f1-font-display grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 px-1 text-xs font-medium tracking-wide text-f1-red lg:gap-6",
                n === 1 && "hidden xl:grid",
                "fit:hidden!",
              )}
            >
              <span># · 📝 คำถาม (ซ้าย)</span>
              <span>⟷</span>
              <span className="text-center">✅ คำตอบ (ขวา)</span>
            </div>
          ))}
          {game.pairs.map((pair, idx) => {
            const occupantId = slots[pair.id];
            const occupantChip = occupantId ? chips.find((c) => c.id === occupantId) : undefined;
            const isLocked = lockedCorrect.has(pair.id);
            const isWrong = wrongBoxIds.has(pair.id);
            return (
              <div key={pair.id} className={rowGrid}>
                {renderQuestion(pair, idx)}
                <span className="f1-font-mono self-center text-f1-red fit:shrink-0">⟷</span>
                <div className="relative fit:aspect-video fit:h-full fit:shrink-0">
                  <div
                    data-dropbox-id={pair.id}
                    onClick={() => handleSlotClick(pair.id)}
                    className={cn(
                      "flex aspect-video w-full items-center justify-center fit:aspect-auto fit:h-full rounded-xl border-4 border-dashed border-[#8B8B95] bg-white/70 text-sm transition-colors",
                      occupantChip && "border-solid border-f1-ink bg-white",
                      selectedId && !isLocked && "f1-slot-blink cursor-pointer",
                      isLocked && "f1-correct-bounce border-solid border-[#15803D] bg-f1-ok-bg",
                      !isLocked && isWrong && "f1-shake border-solid border-[#DC0000] bg-[#DC0000]/10",
                      !isLocked && !isWrong && hoverBoxId === pair.id && "border-[#DC0000] bg-[#DC0000]/10",
                    )}
                  >
                    {occupantChip ? (
                      renderChip(occupantChip, true)
                    ) : (
                      <span className="f1-font-mono text-xs text-[#8B8B95]">___</span>
                    )}
                  </div>
                  {occupantChip && !isLocked && !locked && (
                    <button
                      type="button"
                      onClick={() => removeFromSlot(pair.id)}
                      className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#DC0000] text-xs font-bold text-white"
                      aria-label="ลบการ์ดออกจากช่อง"
                    >
                      ✕
                    </button>
                  )}
                  {isLocked && (
                    <div className="f1-checkered-flash pointer-events-none absolute inset-0 rounded-xl" />
                  )}
                  {!isLocked && isWrong && (
                    <div className="f1-redflag-flash pointer-events-none absolute inset-0 rounded-xl" />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 fit:flex-row fit:items-baseline fit:gap-3">
          <h2 className={sectionTitle}>📦 คลังคำตอบ • PIT BANK</h2>
          <p className="f1-font-display text-sm text-f1-mute fit:text-xs">คลิกเลือก → แล้วคลิกช่องในคอลัมน์ขวา</p>
        </div>

        <div className="min-h-20 flex flex-wrap gap-2 rounded-sm border-t-4 border-[#DC0000] bg-white/90 p-4 lg:gap-4 lg:p-6 fit:min-h-[7.75rem] fit:min-[1700px]:min-h-[4.75rem] fit:gap-2 fit:p-2">
          {pool.length === 0 && phase !== "finished" && (
            <span className="f1-font-display text-sm text-[#8B8B95]">คลังว่าง — ใส่ครบทุกช่องแล้ว</span>
          )}
          {pool.map((chip) => renderChip(chip))}
        </div>

        <div className="flex flex-col gap-4 fit:flex-row fit:items-center fit:gap-4">
        <h2 className={cn(sectionTitle, "fit:shrink-0")}>🚦 RACE CONTROL • ตรวจคำตอบ</h2>

        <div className="flex flex-col items-center gap-3 fit:contents">
          {!locked && (
            <p className="f1-font-display text-center text-sm text-f1-red fit:flex-1 fit:text-left fit:text-xs fit:2xl:text-sm">
              {isAllFilled
                ? "ครบแล้ว! กดตรวจสอบได้เลย"
                : `⚠️ ใส่ให้ครบ ${total} ช่องก่อนส่ง (ตอนนี้ ${filledCount}/${total}) – คลิกคำตอบในคลังแล้วคลิกช่องทางขวา`}
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-2 fit:ml-auto fit:shrink-0">
            {!locked && (
              <Button
                disabled={!isAllFilled}
                onClick={() => handleCheck(false)}
                className={cn(
                  "f1-font-display",
                  isAllFilled ? "f1-glow bg-red-600 text-white hover:bg-red-700" : "bg-zinc-200 text-zinc-500",
                )}
              >
                🏁 ตรวจสอบคำตอบ (CHECK)
              </Button>
            )}
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
                className="f1-font-display border-[#DC0000] bg-white text-[#DC0000] hover:bg-[#DC0000]/10"
                onClick={resetAll}
              >
                รีเซ็ตทั้งหมด
              </Button>
            )}
          </div>
        </div>
        </div>

        <div className="f1-font-display space-y-1 pt-4 text-xs text-f1-mute fit:flex fit:justify-between fit:gap-6 fit:space-y-0 fit:overflow-hidden fit:whitespace-nowrap fit:pt-0 fit:text-[10px]">
          <p>
            * ซ้าย = คำถามคงที่ • ขวา = คำตอบ • คลิกเลือกจากคลังล่างแล้วคลิกช่องที่จะวาง • หากผิด
            ระบบจะแนะนำวิดีโอสอนเฉพาะข้อที่ผิด
          </p>
          <p>I-DOJO F1 RACING RED • LEFT QUESTION • RIGHT ANSWER • FERRARI RED #DC0000 • GREEN #22C55E</p>
        </div>
      </main>

      {showHelp && (
        <div
          className="fixed inset-0 z-[65] flex items-center justify-center overflow-y-auto bg-black/60 p-4"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="f1-font-display relative my-auto w-full max-w-xl rounded-sm border-4 border-[#DC0000] bg-white p-6 text-sm text-f1-ink"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowHelp(false)}
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-[#DC0000] font-bold text-white"
              aria-label="ปิดวิธีเล่น"
            >
              ✕
            </button>
            <h2 className="mb-3 font-bold text-f1-red">📋 วิธีเล่น (แบบคลิก)</h2>
            {howToList}
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
          <div className="f1-font-display relative my-auto w-full max-w-lg rounded-sm border-4 border-[#DC0000] bg-white p-6 text-f1-ink">
            <button
              type="button"
              onClick={() => setModalData(null)}
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-[#DC0000] font-bold text-white"
              aria-label="ปิดผลตรวจ"
            >
              ✕
            </button>
            <p className="px-6 text-center text-xs font-medium tracking-widest text-f1-red">
              🏆 RACE RESULT • SUMMARY
            </p>
            <p className="mt-1 px-6 text-center text-2xl font-bold">
              {modalData.isTimeout && "⏰ หมดเวลา! "}
              {tier.title}
            </p>
            {tier.sub && <p className="mt-1 text-center text-sm text-f1-red">{tier.sub}</p>}

            {embedded && portalStatus !== "idle" && (
              <div
                className={cn(
                  "mt-3 flex flex-wrap items-center justify-center gap-2 rounded-sm px-3 py-2 text-center text-sm",
                  portalStatus === "sending" && "bg-zinc-100 text-f1-ink",
                  portalStatus === "sent" && "bg-f1-ok-bg text-f1-ok-ink",
                  portalStatus === "error" && "bg-f1-bad-bg text-f1-bad",
                )}
              >
                {portalStatus === "sending" && "📡 กำลังส่งผลไปที่จอ…"}
                {portalStatus === "sent" && "✓ ส่งผลไปที่จอแล้ว"}
                {portalStatus === "error" && (
                  <>
                    <span>ส่งผลไม่สำเร็จ: {portalMsg}</span>
                    <Button size="sm" className="bg-[#DC0000] text-white hover:bg-[#b00000]" onClick={resendReport}>
                      ส่งใหม่
                    </Button>
                  </>
                )}
              </div>
            )}

            <div className="f1-font-mono mt-4 grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-sm bg-zinc-100 p-2">
                <p className="text-[10px] text-f1-red">TIME USED</p>
                <p className="text-lg font-bold">{formatTime(modalData.timeUsedSeconds)}</p>
              </div>
              <div className="rounded-sm bg-zinc-100 p-2">
                <p className="text-[10px] text-f1-red">CORRECT</p>
                <p className="text-lg font-bold">
                  {modalData.score}/{modalData.total}
                </p>
              </div>
              <div className="rounded-sm bg-zinc-100 p-2">
                <p className="text-[10px] text-f1-red">ACCURACY</p>
                <p className="text-lg font-bold">{Math.round((modalData.score / modalData.total) * 100)}%</p>
              </div>
            </div>

            {modalData.wrong.length > 0 && (
              <>
                <p className="mt-4 text-center font-bold text-f1-bad">
                  มีคำตอบผิด! {modalData.wrong.length} ข้อ
                </p>
                <div className="mt-2 max-h-[40vh] space-y-3 overflow-y-auto pr-1">
                  {modalData.wrong.map((w) => {
                    const pair = game.pairs.find((p) => p.id === w.pairId);
                    return (
                      <div key={w.pairId} className="space-y-2 rounded-sm border border-f1-line bg-zinc-100 p-3">
                        <h4 className="font-bold">🏷️ {w.topic}</h4>
                        <p className="rounded-sm border border-red-200 bg-f1-bad-bg px-2 py-1 text-sm text-f1-bad">
                          ❌ {w.yourAnswer ?? "(ยังไม่ได้ใส่)"}
                        </p>
                        <p className="rounded-sm border border-green-200 bg-f1-ok-bg px-2 py-1 text-sm text-f1-ok-ink">
                          ✅ {w.correctAnswer}
                        </p>
                        {w.hasVideo && (
                          <Button
                            size="sm"
                            className="bg-[#DC0000] text-white hover:bg-[#b00000]"
                            onClick={() => openVideo(w.pairId)}
                          >
                            ▶️ ดูวิดีโอสอน{pair?.videoTitle ? `: ${pair.videoTitle}` : ""}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
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
                  className="border-[#DC0000] bg-white text-[#DC0000] hover:bg-[#DC0000]/10"
                  onClick={resetAll}
                >
                  เล่นใหม่
                </Button>
              )}
              {!modalData.allCorrect && !modalData.isTimeout && !resultHandedOff && (
                <Button className="bg-[#DC0000] text-white hover:bg-[#b00000]" onClick={retryWrongOnly}>
                  ลองใหม่เฉพาะข้อผิด
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {videoPair?.videoUrl && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/90 p-4">
          <div className="f1-font-display relative my-auto w-full max-w-2xl rounded-sm border-4 border-[#DC0000] bg-white p-4 text-f1-ink">
            <button
              type="button"
              onClick={() => setVideoView(null)}
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-[#DC0000] font-bold text-white"
              aria-label="ปิดวิดีโอ"
            >
              ✕
            </button>
            <VideoPlayer url={videoPair.videoUrl} className="mt-6" />
            <h3 className="mt-3 text-lg font-bold">{videoPair.videoTitle || videoPair.promptText}</h3>
            {videoPair.videoDesc && <p className="mt-1 text-sm text-f1-mute">{videoPair.videoDesc}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                className="border-[#DC0000] bg-white text-[#DC0000] hover:bg-[#DC0000]/10"
                onClick={() => setVideoView(null)}
              >
                เข้าใจแล้ว ✓
              </Button>
              {hasNextVideo && videoView && (
                <Button
                  className="bg-f1-ink text-white hover:bg-zinc-700"
                  onClick={() => setVideoView({ ...videoView, index: videoView.index + 1 })}
                >
                  ข้อต่อไป →
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
