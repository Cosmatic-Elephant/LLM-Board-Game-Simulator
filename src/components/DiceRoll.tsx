"use client";

// 3×3 grid positions (0–8), reading left-to-right top-to-bottom
const PIP_MAP: Record<number, number[]> = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 3, 6, 2, 5, 8],
};

const PLAYER_BG: Record<string, string> = {
  red:    "bg-red-500",
  yellow: "bg-yellow-400",
  green:  "bg-green-500",
  blue:   "bg-blue-500",
  orange: "bg-orange-500",
  purple: "bg-purple-500",
  pink:   "bg-pink-400",
  white:  "bg-gray-200",
};

interface DieProps {
  value: number;
  playerColor: string;
  highlighted?: boolean;
  onHover?: (value: number | null) => void;
  fadeInDelay?: number;
  fadeDuration?: number;
  exiting?: boolean;
}

export function Die({ value, playerColor, highlighted = false, onHover, fadeInDelay, fadeDuration = 250, exiting = false }: DieProps) {
  const activePips = new Set(PIP_MAP[value] ?? []);
  const bg = PLAYER_BG[playerColor] ?? "bg-gray-400";

  const style = exiting
    ? { animation: `die-exit ${fadeDuration}ms ease-out forwards`, pointerEvents: "none" as const }
    : fadeInDelay !== undefined
    ? { animation: `fade-in-die ${fadeDuration}ms ease-out ${fadeInDelay}ms both` }
    : undefined;

  return (
    <div
      style={style}
      className={[
        "grid grid-cols-3 grid-rows-3 gap-0.5 p-2 rounded-xl w-14 h-14 cursor-default",
        "transition-all duration-150",
        bg,
        highlighted ? "ring-2 ring-white scale-110 shadow-lg shadow-white/20" : "",
      ].join(" ")}
      onMouseEnter={() => onHover?.(value)}
      onMouseLeave={() => onHover?.(null)}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className="flex items-center justify-center">
          {activePips.has(i) && (
            <div className="w-2.5 h-2.5 rounded-full bg-gray-900" />
          )}
        </div>
      ))}
    </div>
  );
}
