import { useEffect, useRef, useState } from "react";
import { Confetti } from "../components/Confetti";
import { F1Header } from "../components/F1Header";
import { VideoPlayer } from "../components/VideoPlayer";
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
    <h1 className="f1-font-display text-2xl font-bold text-white">
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

  useEffect(() => {
    setLoadError(null);
    getGame()
      .then((g) => {
        setGame(g);
        setChips(makeChips(g.pairs));
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
      if (!pendingRef.current) return;
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
    if (game.timeLimitSeconds > 0 && elapsed >= game.timeLimitSeconds) {
      handleCheck(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elapsed, phase, game]);

  if (!game) {
    return (
      <div className="f1-carbon-bg min-h-screen">
        <F1Header />
        <main className="f1-font-display mx-auto max-w-3xl space-y-3 p-6 text-[#FFD60A]">
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
  const hasLimit = game.timeLimitSeconds > 0;
  const remaining = hasLimit ? Math.max(0, game.timeLimitSeconds - elapsed) : null;
  const lowTime = remaining !== null && remaining <= 60;
  const locked = phase === "finished" || phase === "timeout";

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
        hasVideo: Boolean(pair.videoUrl),
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
          "f1-font-display touch-none select-none border-2 bg-[#161616] font-medium text-white shadow-[0_0_0_1px_rgba(220,0,0,0.3)]",
          isSelected
            ? "border-[#FFD60A] shadow-[0_0_14px_2px_rgba(255,214,10,0.7)]"
            : "border-[#DC0000]",
          inSlot
            ? "flex h-full w-full min-h-0 cursor-grab flex-col items-center justify-center gap-1 rounded-md p-2 text-center text-sm active:cursor-grabbing sm:text-base xl:text-xl"
            : "flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm lg:px-5 lg:py-3 lg:text-lg",
        )}
      >
        {hasImg && (
          <img
            src={chip.image}
            alt=""
            draggable={false}
            className={inSlot ? "min-h-0 w-full flex-1 object-contain" : "h-12 w-16 object-contain lg:h-16 lg:w-24"}
          />
        )}
        <span className={cn("leading-snug", captionClass)}>
          <span className="mr-1 text-[#FFD60A]">{chip.letter}.</span>
          {chip.text}
        </span>
      </div>
    );
  }

  function renderQuestion(pair: MatchPair, idx: number) {
    const hasImg = pair.promptType !== "text" && Boolean(pair.promptImage);
    return (
      <div
        className={cn(
          "relative flex min-w-0 gap-2 rounded-sm border-2 border-[#333] bg-black/70 p-3 lg:p-5",
          hasImg ? "flex-col items-center justify-center text-center" : "items-center gap-3 lg:gap-4",
        )}
      >
        <span
          className={cn(
            "f1-font-mono text-xs text-[#FFD60A] lg:text-base",
            hasImg && "absolute left-3 top-2 lg:left-5 lg:top-3",
          )}
        >
          {idx + 1}
        </span>
        <span className="f1-font-mono absolute right-2 top-2 rounded-sm border border-[#333] px-1.5 py-0.5 text-[10px] text-[#FFD60A]">
          {TYPE_BADGE[pair.promptType]}
        </span>
        {hasImg && (
          <img
            src={pair.promptImage}
            alt=""
            draggable={false}
            className="mt-4 min-h-0 w-full flex-1 rounded-sm object-contain lg:max-h-36"
          />
        )}
        <span
          className={cn(
            "f1-font-display min-w-0 break-words font-bold text-white lg:text-2xl",
            !hasImg && "flex-1",
            pair.promptType === "image" && "text-sm font-medium text-[#bbb] lg:text-base",
            pair.promptType === "mixed" && "text-base lg:text-xl",
          )}
        >
          {pair.promptText}
        </span>
      </div>
    );
  }

  const videoPair = videoView ? game.pairs.find((p) => p.id === videoView.pairIds[videoView.index]) : undefined;
  const hasNextVideo = videoView ? videoView.index < videoView.pairIds.length - 1 : false;
  const sectionTitle = "f1-font-display text-lg font-bold tracking-wide text-white";
  const rowGrid = "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-3 lg:gap-6";
  const tier = modalData ? resultTier(modalData.score, modalData.total) : null;

  return (
    // ตอนถูกฝัง portal วางปุ่ม "ผ่านสถานี" ทับขอบล่าง ~90px จึงเว้นที่ไว้
    <div className={cn("f1-carbon-bg min-h-screen", embedded ? "pb-28" : "pb-16")}>
      <F1Header />
      <main className="w-full space-y-4 px-6 py-6 lg:px-12">
        <div>
          <GameTitle name={game.name} />
          <p className="f1-font-display mt-1 text-sm font-medium tracking-widest text-[#FFD60A]">
            LEFT Q • RIGHT A — QUESTION LEFT • ANSWER RIGHT • MATCH
          </p>
        </div>

        <div className="f1-font-mono flex flex-wrap items-center gap-x-4 gap-y-1 rounded-sm border-2 border-[#DC0000] bg-black/70 px-4 py-3">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-[#FFD60A]">⏱ TIME</span>
            <span
              className={cn(
                "text-2xl font-bold text-white",
                lowTime && phase === "running" && "f1-timer-blink text-[#DC0000]",
              )}
            >
              {remaining !== null ? formatTime(remaining) : formatTime(elapsed)}
            </span>
          </div>
          <p className="f1-font-display text-sm text-[#FFD60A]">
            · สถานะ:{" "}
            <strong className="text-white">
              {filledCount}/{total} ช่อง • {pool.length} ตัวเลือกเหลือ
            </strong>
          </p>
        </div>

        {remaining !== null && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-[#1a1a1a]">
            <div
              className={cn(
                "h-full rounded-full bg-[#DC0000] transition-all",
                lowTime && phase === "running" && "f1-timer-blink",
              )}
              style={{ width: `${(remaining / game.timeLimitSeconds) * 100}%` }}
            />
          </div>
        )}

        <div className="f1-font-display rounded-sm border border-[#333] bg-black/60 p-4 text-sm text-white">
          <h2 className="mb-2 font-bold text-[#FFD60A]">📋 วิธีเล่น (แบบคลิก)</h2>
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
        </div>

        <h2 className={sectionTitle}>📝 คำถาม • QUESTION ⟷ ✅ คำตอบ • ANSWER</h2>

        <div className="grid gap-x-12 gap-y-4 xl:grid-cols-2">
          {[0, 1].map((n) => (
            <div
              key={n}
              className={cn(
                "f1-font-display grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 px-1 text-xs font-medium tracking-wide text-[#FFD60A] lg:gap-6",
                n === 1 && "hidden xl:grid",
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
                <span className="f1-font-mono self-center text-[#FFD60A]">⟷</span>
                <div className="relative">
                  <div
                    data-dropbox-id={pair.id}
                    onClick={() => handleSlotClick(pair.id)}
                    className={cn(
                      "flex aspect-video w-full items-center justify-center rounded-xl border-4 border-dashed border-[#333] bg-[#111] text-sm transition-colors",
                      selectedId && !isLocked && "cursor-pointer border-[#FFD60A]/50",
                      isLocked && "f1-correct-bounce border-solid border-[#22C55E] bg-green-950/40",
                      !isLocked && isWrong && "f1-shake border-solid border-[#DC0000] bg-[#DC0000]/10",
                      !isLocked && !isWrong && hoverBoxId === pair.id && "border-[#FFD60A] bg-[#222]",
                    )}
                  >
                    {occupantChip ? (
                      renderChip(occupantChip, true)
                    ) : (
                      <span className="f1-font-mono text-xs text-[#555]">___</span>
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

        <h2 className={sectionTitle}>📦 คลังคำตอบ • PIT BANK</h2>
        <p className="f1-font-display -mt-2 text-sm text-[#bbb]">คลิกเลือก → แล้วคลิกช่องในคอลัมน์ขวา</p>

        <div className="min-h-20 flex flex-wrap gap-2 rounded-sm border-t-4 border-[#DC0000] bg-black/70 p-4 lg:gap-4 lg:p-6">
          {pool.length === 0 && phase !== "finished" && (
            <span className="f1-font-display text-sm text-[#555]">คลังว่าง — ใส่ครบทุกช่องแล้ว</span>
          )}
          {pool.map((chip) => renderChip(chip))}
        </div>

        <h2 className={sectionTitle}>🚦 RACE CONTROL • ตรวจคำตอบ</h2>

        <div className="flex flex-col items-center gap-3">
          {!locked && (
            <p className="f1-font-display text-center text-sm text-[#FFD60A]">
              {isAllFilled
                ? "ครบแล้ว! กดตรวจสอบได้เลย"
                : `⚠️ ใส่ให้ครบ ${total} ช่องก่อนส่ง (ตอนนี้ ${filledCount}/${total}) – คลิกคำตอบในคลังแล้วคลิกช่องทางขวา`}
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            {!locked && (
              <Button
                disabled={!isAllFilled}
                onClick={() => handleCheck(false)}
                className={cn(
                  "f1-font-display",
                  isAllFilled ? "f1-glow bg-red-600 text-white hover:bg-red-700" : "bg-gray-600 text-gray-300",
                )}
              >
                🏁 ตรวจสอบคำตอบ (CHECK)
              </Button>
            )}
            {!locked && (
              <Button
                variant="outline"
                className="f1-font-display border-[#333] bg-transparent text-white hover:bg-white/10"
                onClick={clearAnswers}
              >
                ล้างคำตอบ
              </Button>
            )}
            <Button
              variant="outline"
              className="f1-font-display border-[#DC0000] bg-transparent text-white hover:bg-[#DC0000]/20"
              onClick={resetAll}
            >
              รีเซ็ตทั้งหมด
            </Button>
          </div>
        </div>

        <div className="f1-font-display space-y-1 pt-4 text-xs text-[#777]">
          <p>
            * ซ้าย = คำถามคงที่ • ขวา = คำตอบ • คลิกเลือกจากคลังล่างแล้วคลิกช่องที่จะวาง • หากผิด
            ระบบจะแนะนำวิดีโอสอนเฉพาะข้อที่ผิด
          </p>
          <p>I-DOJO F1 RACING RED • LEFT QUESTION • RIGHT ANSWER • FERRARI RED #DC0000 • GREEN #22C55E</p>
        </div>
      </main>

      {modalData?.allCorrect && <Confetti />}

      {modalData && tier && (
        <div
          className={cn(
            "fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/80 p-4",
            embedded && "pb-28",
          )}
        >
          <div className="f1-font-display relative my-auto w-full max-w-lg rounded-sm border-4 border-[#DC0000] bg-[#111] p-6 text-white">
            <button
              type="button"
              onClick={() => setModalData(null)}
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-[#DC0000] font-bold text-white"
              aria-label="ปิดผลตรวจ"
            >
              ✕
            </button>
            <p className="px-6 text-center text-xs font-medium tracking-widest text-[#FFD60A]">
              🏆 RACE RESULT • SUMMARY
            </p>
            <p className="mt-1 px-6 text-center text-2xl font-bold">
              {modalData.isTimeout && "⏰ หมดเวลา! "}
              {tier.title}
            </p>
            {tier.sub && <p className="mt-1 text-center text-sm text-[#FFD60A]">{tier.sub}</p>}

            {embedded && portalStatus !== "idle" && (
              <div
                className={cn(
                  "mt-3 flex flex-wrap items-center justify-center gap-2 rounded-sm px-3 py-2 text-center text-sm",
                  portalStatus === "sending" && "bg-black/60 text-[#FFD60A]",
                  portalStatus === "sent" && "bg-green-950/60 text-green-300",
                  portalStatus === "error" && "bg-red-950/60 text-red-300",
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
              <div className="rounded-sm bg-black/60 p-2">
                <p className="text-[10px] text-[#FFD60A]">TIME USED</p>
                <p className="text-lg font-bold">{formatTime(modalData.timeUsedSeconds)}</p>
              </div>
              <div className="rounded-sm bg-black/60 p-2">
                <p className="text-[10px] text-[#FFD60A]">CORRECT</p>
                <p className="text-lg font-bold">
                  {modalData.score}/{modalData.total}
                </p>
              </div>
              <div className="rounded-sm bg-black/60 p-2">
                <p className="text-[10px] text-[#FFD60A]">ACCURACY</p>
                <p className="text-lg font-bold">{Math.round((modalData.score / modalData.total) * 100)}%</p>
              </div>
            </div>

            {modalData.wrong.length > 0 && (
              <>
                <p className="mt-4 text-center font-bold text-red-300">
                  มีคำตอบผิด! {modalData.wrong.length} ข้อ
                </p>
                <div className="mt-2 max-h-[40vh] space-y-3 overflow-y-auto pr-1">
                  {modalData.wrong.map((w) => {
                    const pair = game.pairs.find((p) => p.id === w.pairId);
                    return (
                      <div key={w.pairId} className="space-y-2 rounded-sm border border-[#333] bg-black/60 p-3">
                        <h4 className="font-bold">🏷️ {w.topic}</h4>
                        <p className="rounded-sm bg-red-950/60 px-2 py-1 text-sm text-red-300">
                          ❌ {w.yourAnswer ?? "(ยังไม่ได้ใส่)"}
                        </p>
                        <p className="rounded-sm bg-green-950/60 px-2 py-1 text-sm text-green-300">
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

            <div className="mt-5 flex justify-center gap-2">
              <Button
                variant="outline"
                className="border-[#DC0000] bg-transparent text-white hover:bg-[#DC0000]/20"
                onClick={resetAll}
              >
                เล่นใหม่
              </Button>
              {!modalData.allCorrect && !modalData.isTimeout && (
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
          <div className="f1-font-display relative my-auto w-full max-w-2xl rounded-sm border-4 border-[#DC0000] bg-[#111] p-4 text-white">
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
            {videoPair.videoDesc && <p className="mt-1 text-sm text-[#bbb]">{videoPair.videoDesc}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                className="border-[#DC0000] bg-transparent text-white hover:bg-[#DC0000]/20"
                onClick={() => setVideoView(null)}
              >
                เข้าใจแล้ว ✓
              </Button>
              {hasNextVideo && videoView && (
                <Button
                  className="bg-[#FFD60A] text-black hover:bg-[#e6c000]"
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
