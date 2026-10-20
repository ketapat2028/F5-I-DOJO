import { Link } from "react-router";

export function F1Header() {
  return (
    <header className="f1-carbon-bg border-b-4 border-[#DC0000]">
      <div className="h-1.5 fit:h-1 w-full bg-gradient-to-r from-[#DC0000] via-white to-[#DC0000]" />
      <div className="flex w-full items-center gap-3 px-6 py-3 lg:px-12 fit:px-8 fit:py-1.5">
        <span className="f1-font-display flex h-9 w-9 fit:h-7 fit:w-7 items-center justify-center rounded-sm bg-[#DC0000] text-sm font-bold text-white">
          01
        </span>
        <Link to="/" className="f1-font-display text-xl fit:text-lg font-bold tracking-wide text-white">
          I-DOJO <span className="text-f1-red-bright">RACING</span>
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
