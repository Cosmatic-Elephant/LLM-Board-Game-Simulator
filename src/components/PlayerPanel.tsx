import type { Color, PlayerState } from "@/types/game";

const BORDER: Record<Color, string> = {
  red:    "border-red-500",
  yellow: "border-yellow-400",
  green:  "border-green-500",
  blue:   "border-blue-500",
};

const DOT: Record<Color, string> = {
  red:    "bg-red-500",
  yellow: "bg-yellow-400",
  green:  "bg-green-500",
  blue:   "bg-blue-500",
};

const NAME_COLOR: Record<Color, string> = {
  red:    "text-red-400",
  yellow: "text-yellow-300",
  green:  "text-green-400",
  blue:   "text-blue-400",
};

interface PlayerPanelProps {
  player: PlayerState;
  label: string;
  isActive: boolean;
}

export function PlayerPanel({ player, label, isActive }: PlayerPanelProps) {
  return (
    <div
      className={[
        "flex flex-col gap-1.5 px-5 py-3 rounded-xl border-2 min-w-[150px] transition-all duration-200",
        isActive
          ? `bg-gray-700 ${BORDER[player.color]} shadow-lg -translate-y-1.5`
          : "bg-gray-900/80 border-gray-800",
      ].join(" ")}
    >
      {/* Name row */}
      <div className="flex items-center gap-2">
        <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${DOT[player.color]}`} />
        <span className={`text-sm font-bold ${isActive ? NAME_COLOR[player.color] : "text-gray-400"}`}>
          {label}
        </span>
        {player.isLLM && (
          <span className="ml-auto text-xs text-gray-600">AI</span>
        )}
      </div>

      {/* Stats */}
      <div className="text-xs text-gray-400">
        주사위 {player.diceRemaining}개
      </div>
      <div className={`text-sm font-mono font-semibold ${isActive ? "text-white" : "text-gray-300"}`}>
        {player.score.toLocaleString()}
      </div>

    </div>
  );
}
