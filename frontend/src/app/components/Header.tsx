import { Link } from "react-router";

export function Header() {
  return (
    <header className="flex items-center gap-4 border-b px-6 py-4">
      <span className="font-medium">I-DOJO</span>
      <nav className="flex gap-3 text-sm text-muted-foreground">
        <Link to="/">เล่นเกม</Link>
        <Link to="/editor">แก้ไขโจทย์</Link>
        <Link to="/dashboard">Dashboard</Link>
      </nav>
    </header>
  );
}
