const COLORS = ["#DC0000", "#FFD60A", "#FFFFFF", "#22c55e", "#3b82f6"];

const PIECES = Array.from({ length: 48 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 53) % 100) / 100,
  duration: 2 + ((i * 29) % 100) / 60,
  color: COLORS[i % COLORS.length],
}));

export function Confetti() {
  return (
    <div className="pointer-events-none fixed inset-0 z-[80] overflow-hidden" aria-hidden>
      {PIECES.map((p, i) => (
        <span
          key={i}
          className="f1-confetti-piece"
          style={{
            left: `${p.left}%`,
            backgroundColor: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}
