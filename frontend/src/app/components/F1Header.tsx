import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Link } from "react-router";
import { cn } from "./ui/utils";

export function F1Header() {
  return (
    <header className="f1-navy-bg border-b-4 border-f1-brand">
      <div className="h-1.5 fit:h-1 w-full bg-gradient-to-r from-f1-brand via-white to-f1-brand" />
      <div className="flex w-full items-center gap-3 px-6 py-3 lg:px-12 fit:px-8 fit:py-1.5">
        <span className="f1-font-display flex h-9 w-9 fit:h-7 fit:w-7 items-center justify-center rounded-sm bg-f1-brand text-sm font-bold text-white">
          05
        </span>
        <Link to="/" className="f1-font-display text-xl fit:text-lg font-bold tracking-wide text-white">
          I-DOJO <span className="text-f1-brand-bright">PIT 5</span>
          <span className="ml-2 hidden text-sm font-medium text-zinc-300 sm:inline">DOMINO IMPACT</span>
        </Link>
        <nav className="f1-font-display ml-auto flex gap-4 text-sm font-medium tracking-wide text-zinc-300">
          <Link to="/" className="hover:text-white">
            เล่นเกม
          </Link>
          <Link to="/editor" className="hover:text-white">
            แก้ไขโจทย์
          </Link>
        </nav>
      </div>
    </header>
  );
}

// หน้าเล่น: ซ่อน navbar ไว้ให้พื้นที่เล่นเต็มจอ · เลื่อนลงมาเมื่อชี้เมาส์ที่มุมขวาบนของจอ (แถบบาง ๆ ชิดขอบ ไม่ทับปุ่มวิธีเล่น)
// อยู่บน navbar ต่อได้ เลื่อนออกแล้วหายไปเอง · จอสัมผัส: แตะมุมขวาบน = แสดง แล้วหายเองหลังไม่กี่วินาที
// ลอยทับด้านบน (fixed) ไม่ดันเลย์เอาต์เกม
const HIDE_DELAY_MOUSE_MS = 400;
const HIDE_DELAY_TOUCH_MS = 4000;

export function AutoHideF1Header() {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  function show() {
    window.clearTimeout(timerRef.current);
    setOpen(true);
  }
  function hideSoon(e?: ReactPointerEvent) {
    window.clearTimeout(timerRef.current);
    const delay = e?.pointerType === "touch" ? HIDE_DELAY_TOUCH_MS : HIDE_DELAY_MOUSE_MS;
    timerRef.current = window.setTimeout(() => setOpen(false), delay);
  }

  return (
    <>
      {/* จุดชี้มุมขวาบน — ใช้ px ไม่ขยายตาม f1-play-scale (ขอบจอชนเมาส์อยู่แล้ว ไม่ต้องใหญ่) */}
      <div
        aria-hidden
        className="fixed right-0 top-0 z-[90] h-[14px] w-[260px]"
        onPointerEnter={show}
        onPointerDown={show}
        onPointerLeave={hideSoon}
      />
      <div
        className={cn(
          "fixed inset-x-0 top-0 z-[90] shadow-lg transition-[translate] duration-200 ease-out",
          open ? "translate-y-0" : "pointer-events-none -translate-y-full",
        )}
        onPointerEnter={show}
        onPointerLeave={hideSoon}
        onFocus={show}
        onBlur={() => hideSoon()}
      >
        <F1Header />
      </div>
    </>
  );
}
