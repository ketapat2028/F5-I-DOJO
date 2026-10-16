import { Link } from "react-router";

export function F1Header() {
  return (
    <header className="f1-carbon-bg border-b-4 border-[#DC0000]">
      <div className="h-1.5 w-full bg-gradient-to-r from-[#DC0000] via-[#FFD60A] to-[#DC0000]" />
      <div className="flex w-full items-center gap-3 px-6 py-3 lg:px-12">
        <span className="f1-font-display flex h-9 w-9 items-center justify-center rounded-sm bg-[#DC0000] text-sm font-bold text-white">
          01
        </span>
        <Link to="/" className="f1-font-display text-xl font-bold tracking-wide text-white">
          I-DOJO <span className="text-[#DC0000]">RACING</span>
        </Link>
        <nav className="f1-font-display ml-auto flex gap-4 text-sm font-medium tracking-wide text-[#FFD60A]">
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
