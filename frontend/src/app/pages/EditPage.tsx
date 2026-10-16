import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { F1Header } from "../components/F1Header";
import { VideoPlayer } from "../components/VideoPlayer";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import type { MatchPair, PromptType, Theme } from "../types/theme";
import { fileToImageDataUrl } from "../utils/image";
import {
  exportGameJson,
  getGame,
  isPairComplete,
  makeEmptyPair,
  parseImportedPairs,
  saveGame,
} from "../utils/gameStore";

const MIN_PAIRS = 2;
const TYPE_LABEL: Record<PromptType, string> = { text: "ข้อความ", image: "รูปภาพ", mixed: "ผสม (ภาพ + ข้อความ)" };

interface SideFieldsProps {
  title: string;
  type: PromptType;
  text: string;
  image?: string;
  onType: (t: PromptType) => void;
  onText: (v: string) => void;
  onImage: (v: string | undefined) => void;
}

function SideFields({ title, type, text, image, onType, onText, onImage }: SideFieldsProps) {
  async function handleUpload(file: File | null) {
    if (!file) return;
    onImage(await fileToImageDataUrl(file));
  }
  const needsImage = type === "image" || type === "mixed";
  return (
    <div className="space-y-3 rounded-sm border border-[#333] bg-black/40 p-3">
      <p className="f1-font-display text-sm font-bold text-white">{title}</p>
      <div className="flex flex-wrap gap-2">
        {(["text", "image", "mixed"] as PromptType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => onType(t)}
            className={`f1-font-display rounded-sm border px-3 py-1 text-xs font-medium ${
              type === t ? "border-[#DC0000] bg-[#DC0000] text-white" : "border-[#333] bg-[#161616] text-[#FFD60A]"
            }`}
          >
            {TYPE_LABEL[t]}
          </button>
        ))}
      </div>
      <label className="block space-y-1 text-sm text-[#FFD60A]">
        <span>{type === "image" ? "ข้อความกำกับภาพ (ไม่บังคับ แต่ใช้แสดงในรายการข้อผิด)" : "ข้อความ"}</span>
        <Input value={text} onChange={(e) => onText(e.target.value)} className="bg-[#161616] text-white" />
      </label>
      {needsImage && (
        <div className="space-y-2 text-sm text-[#FFD60A]">
          <span>รูปภาพ (ใส่ลิงก์หรืออัปโหลด)</span>
          <div className="flex flex-wrap items-center gap-3">
            {image && (
              <img src={image} alt="" className="h-16 w-24 rounded-sm border-2 border-[#333] bg-black object-contain" />
            )}
            <Input
              value={image && !image.startsWith("data:") ? image : ""}
              onChange={(e) => onImage(e.target.value || undefined)}
              placeholder={image?.startsWith("data:") ? "(ใช้รูปที่อัปโหลดอยู่)" : "วางลิงก์รูป https://..."}
              className="w-60 bg-[#161616] text-white"
            />
            <input
              type="file"
              accept="image/*"
              onChange={(e) => handleUpload(e.target.files?.[0] ?? null)}
              className="text-xs text-[#FFD60A]"
            />
            {image && (
              <Button
                variant="ghost"
                size="sm"
                className="text-[#DC0000] hover:bg-[#DC0000]/20 hover:text-white"
                onClick={() => onImage(undefined)}
              >
                ลบรูป
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function EditPage() {
  const navigate = useNavigate();
  const [game, setGame] = useState<Theme | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getGame().then(setGame);
  }, []);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 3500);
    return () => clearTimeout(t);
  }, [status]);

  if (!game) {
    return (
      <div className="f1-carbon-bg min-h-screen">
        <F1Header />
        <main className="mx-auto max-w-3xl p-6 text-[#FFD60A]">กำลังโหลด...</main>
      </div>
    );
  }

  function updatePair(pairId: string, patch: Partial<MatchPair>) {
    setGame((prev) =>
      prev
        ? { ...prev, pairs: prev.pairs.map((p) => (p.id === pairId ? { ...p, ...patch } : p)) }
        : prev,
    );
  }

  function addPair() {
    setGame((prev) => (prev ? { ...prev, pairs: [...prev.pairs, makeEmptyPair()] } : prev));
  }

  function removePair(pairId: string) {
    setGame((prev) =>
      prev && prev.pairs.length > MIN_PAIRS
        ? { ...prev, pairs: prev.pairs.filter((p) => p.id !== pairId) }
        : prev,
    );
  }

  async function handleSave() {
    if (!game) return;
    const badIndex = game.pairs.findIndex((p) => !isPairComplete(p));
    if (badIndex !== -1) {
      setStatus(
        `คู่ที่ ${badIndex + 1} ยังไม่ครบ: ประเภทข้อความต้องมีข้อความ, ประเภทรูปภาพต้องมีรูป, ประเภทผสมต้องมีทั้งสองอย่าง`,
      );
      return;
    }
    setSaving(true);
    await saveGame(game);
    setSaving(false);
    navigate("/");
  }

  async function handleCopyJson() {
    if (!game) return;
    await navigator.clipboard.writeText(exportGameJson(game));
    setStatus("คัดลอก JSON แล้ว");
  }

  function handleDownloadJson() {
    if (!game) return;
    const blob = new Blob([exportGameJson(game)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "f1-dojo-pairs.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleImportFile(file: File | null) {
    if (!file || !game) return;
    try {
      const pairs = parseImportedPairs(await file.text());
      setGame({ ...game, pairs });
      setStatus(`นำเข้า ${pairs.length} คู่แล้ว`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "นำเข้าไฟล์ไม่สำเร็จ");
    }
  }

  return (
    <div className="f1-carbon-bg min-h-screen pb-16">
      <F1Header />
      <main className="mx-auto max-w-4xl space-y-4 p-6">
        <h1 className="f1-font-display text-2xl font-bold text-white">🛠️ EDIT MODE • แก้ไขโจทย์</h1>

        <div className="grid gap-3 rounded-sm border-2 border-[#333] bg-black/70 p-4 sm:grid-cols-2">
          <label className="space-y-1 text-sm text-[#FFD60A]">
            <span>ชื่อเกม</span>
            <Input
              value={game.name}
              onChange={(e) => setGame({ ...game, name: e.target.value })}
              className="bg-[#161616] text-white"
            />
          </label>
          <label className="space-y-1 text-sm text-[#FFD60A]">
            <span>จำกัดเวลา (วินาที, 0 = ไม่จำกัด)</span>
            <Input
              type="number"
              min={0}
              value={game.timeLimitSeconds}
              onChange={(e) =>
                setGame({ ...game, timeLimitSeconds: Math.max(0, Number(e.target.value) || 0) })
              }
              className="bg-[#161616] text-white"
            />
          </label>
        </div>

        <h2 className="f1-font-display text-sm font-medium text-[#FFD60A]">คู่ที่ต้องจับคู่</h2>

        {game.pairs.map((pair, idx) => (
          <div key={pair.id} className="space-y-3 rounded-sm border-2 border-[#333] bg-black/70 p-4">
            <div className="flex items-center justify-between">
              <span className="f1-font-display text-white">คู่ที่ {idx + 1}</span>
              <Button
                variant="ghost"
                size="sm"
                className="text-[#DC0000] hover:bg-[#DC0000]/20 hover:text-white"
                disabled={game.pairs.length <= MIN_PAIRS}
                onClick={() => removePair(pair.id)}
              >
                ลบคู่นี้
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <SideFields
                title="📝 คำถาม (ซ้าย)"
                type={pair.promptType}
                text={pair.promptText}
                image={pair.promptImage}
                onType={(t) => updatePair(pair.id, { promptType: t })}
                onText={(v) => updatePair(pair.id, { promptText: v })}
                onImage={(v) => updatePair(pair.id, { promptImage: v })}
              />
              <SideFields
                title="✅ คำตอบ (ขวา)"
                type={pair.answerType}
                text={pair.answerText}
                image={pair.answerImage}
                onType={(t) => updatePair(pair.id, { answerType: t })}
                onText={(v) => updatePair(pair.id, { answerText: v })}
                onImage={(v) => updatePair(pair.id, { answerImage: v })}
              />
            </div>

            <div className="space-y-2 border-t border-[#333] pt-3 text-sm text-[#FFD60A]">
              <span className="f1-font-display">▶️ วิดีโอสอน (แสดงเมื่อตอบข้อนี้ผิด)</span>
              <label className="block space-y-1">
                <span>Video URL (ลิงก์ YouTube ทั้งแบบ watch และ embed หรือไฟล์ .mp4)</span>
                <Input
                  value={pair.videoUrl ?? ""}
                  onChange={(e) => updatePair(pair.id, { videoUrl: e.target.value })}
                  placeholder="https://www.youtube.com/watch?v=รหัสวิดีโอ หรือ https://.../video.mp4"
                  className="bg-[#161616] text-white"
                />
              </label>
              <label className="block space-y-1">
                <span>ชื่อวิดีโอ</span>
                <Input
                  value={pair.videoTitle ?? ""}
                  onChange={(e) => updatePair(pair.id, { videoTitle: e.target.value })}
                  className="bg-[#161616] text-white"
                />
              </label>
              <label className="block space-y-1">
                <span>คำอธิบายวิดีโอ</span>
                <textarea
                  value={pair.videoDesc ?? ""}
                  onChange={(e) => updatePair(pair.id, { videoDesc: e.target.value })}
                  rows={2}
                  className="border-input w-full rounded-md border bg-[#161616] px-3 py-2 text-sm text-white outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                />
              </label>
              {pair.videoUrl && (
                <div className="w-64">
                  <VideoPlayer url={pair.videoUrl} />
                </div>
              )}
            </div>
          </div>
        ))}

        <Button
          variant="outline"
          className="border-[#DC0000] bg-transparent text-white hover:bg-[#DC0000]/20"
          onClick={addPair}
        >
          + เพิ่มคู่จับคู่
        </Button>

        <div className="space-y-3 rounded-sm border-2 border-[#333] bg-black/70 p-4">
          <h2 className="f1-font-display text-sm font-medium text-[#FFD60A]">Import / Export JSON</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="border-[#333] text-white" onClick={handleCopyJson}>
              คัดลอก
            </Button>
            <Button variant="outline" size="sm" className="border-[#333] text-white" onClick={handleDownloadJson}>
              ดาวน์โหลดไฟล์
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-[#333] text-white"
              onClick={() => importFileRef.current?.click()}
            >
              อัปโหลดไฟล์
            </Button>
            <input
              ref={importFileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => handleImportFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>

        {status && <p className="text-sm text-[#FFD60A]">{status}</p>}

        <div className="flex justify-end gap-2 border-t-2 border-[#333] pt-4">
          <Button variant="outline" className="border-[#333] text-white" onClick={() => navigate("/")}>
            ยกเลิก
          </Button>
          <Button
            disabled={saving}
            className="f1-font-display bg-[#DC0000] text-white hover:bg-[#b00000]"
            onClick={handleSave}
          >
            บันทึกแล้วกลับไปเล่น
          </Button>
        </div>
      </main>
    </div>
  );
}
