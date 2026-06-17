"use client";

import type { Color, CasinoState } from "@/types/game";

const PLAYER_SQ: Record<Color, string> = {
  red:    "bg-red-500",
  yellow: "bg-yellow-400",
  green:  "bg-green-500",
  blue:   "bg-blue-500",
};

const BILL_COLOR: Record<number, string> = {
  10000:  "#6FCF97",
  20000:  "#56CCB8",
  30000:  "#56B4CC",
  40000:  "#5B8DEF",
  50000:  "#9B7FE8",
  60000:  "#D47FCC",
  70000:  "#E87F9B",
  80000:  "#F2994A",
  90000:  "#F2C94C",
  100000: "#F9E74A",
};

const COLOR_ORDER: Color[] = ["red", "yellow", "green", "blue"];

interface CasinoProps {
  number: number;
  state: CasinoState;
  canPlace: boolean;   // visual: bright vs dark
  selectable: boolean; // functional: click enabled
  /** Card ring highlight — driven by hover OR programmatic scoring state. */
  highlighted: boolean;
  /** Scoring animation: dice rows currently animating out (tie elimination). */
  scoringFadingColors?: Color[];
  /** Scoring animation: dice rows that finished fading — kept invisible. */
  scoringEliminatedColors?: Color[];
  /** Scoring animation: dice row for this color is highlighted (current rank winner). */
  scoringHighlightedColor?: Color | null;
  /** Scoring animation: bill at this index is highlighted. */
  scoringHighlightedBillIdx?: number | null;
  /** Scoring animation: bill at this index is currently fading out. */
  scoringExitingBillIdx?: number | null;
  /** Scoring animation: bill indices that finished fading — kept invisible. */
  scoringExitedBillIndices?: number[];
  /** Scoring animation: all remaining dice/bills fade out simultaneously (table clear). */
  scoringTableClearing?: boolean;
  fadeDuration?: number;
  onHover: (n: number | null) => void;
  onSelect?: () => void;
}

export function Casino({
  number,
  state,
  canPlace,
  selectable,
  highlighted,
  scoringFadingColors,
  scoringEliminatedColors,
  scoringHighlightedColor,
  scoringHighlightedBillIdx,
  scoringExitingBillIdx,
  scoringExitedBillIndices,
  scoringTableClearing,
  fadeDuration = 400,
  onHover,
  onSelect,
}: CasinoProps) {
  const hasAnyDice = COLOR_ORDER.some((c) => state.dice[c] > 0);

  return (
    <div className="flex flex-col gap-1">
      {/* ── Casino card ── */}
      <div
        className={[
          "relative rounded-xl p-2.5 min-h-[90px] border transition-all duration-200",
          canPlace
            ? `bg-gray-800 border-gray-600 ${selectable ? "cursor-pointer hover:bg-gray-700 active:bg-gray-600" : "cursor-default"}`
            : "bg-gray-900/60 border-gray-800/60 opacity-50 cursor-default",
          highlighted ? "ring-2 ring-white opacity-100" : "",
        ].join(" ")}
        onMouseEnter={() => selectable && onHover(number)}
        onMouseLeave={() => onHover(null)}
        onClick={() => { if (selectable) onSelect?.(); }}
      >
        {/* Dice squares grouped by player color */}
        <div className="flex flex-col gap-1 mb-5">
          {hasAnyDice
            ? COLOR_ORDER.map((color) => {
                const count = state.dice[color];
                if (!count) return null;

                const isFading = scoringFadingColors?.includes(color) ?? false;
                const isEliminated = scoringEliminatedColors?.includes(color) ?? false;
                const isClearing = (scoringTableClearing ?? false) && !isEliminated && !isFading;
                const isWinner = scoringHighlightedColor === color;

                return (
                  <div
                    key={color}
                    className="flex flex-wrap gap-0.5"
                    style={
                      isFading || isEliminated || isClearing
                        ? { animation: `dice-sq-exit ${fadeDuration}ms ease-out forwards` }
                        : undefined
                    }
                  >
                    {Array.from({ length: count }, (_, i) => (
                      <div
                        key={i}
                        className={[
                          `w-3.5 h-3.5 rounded-sm ${PLAYER_SQ[color]}`,
                          "transition-all duration-150",
                          isWinner ? "ring-1 ring-white scale-125 shadow shadow-white/30" : "",
                        ].join(" ")}
                      />
                    ))}
                  </div>
                );
              })
            : null}
        </div>

        {/* Casino number */}
        <span className="absolute bottom-1.5 right-2.5 text-xl font-bold text-gray-300 leading-none select-none">
          {number}
        </span>
      </div>

      {/* ── Bills (stack, largest on top) ── */}
      <div className="flex flex-col gap-1">
        {state.bills.map((bill, i) => {
          const isHighlighted = scoringHighlightedBillIdx === i;
          const isExiting = scoringExitingBillIdx === i;
          const isExited = scoringExitedBillIndices?.includes(i) ?? false;
          const isClearing = (scoringTableClearing ?? false) && !isExited && !isExiting;

          return (
            <div
              key={i}
              className={[
                "px-2 py-0.5 text-xs font-mono font-semibold text-center rounded-sm select-none",
                "transition-transform duration-150",
                isHighlighted ? "ring-2 ring-white scale-105" : "",
              ].join(" ")}
              style={{
                backgroundColor: BILL_COLOR[bill] ?? "#e5e7eb",
                color: "#1a1a1a",
                filter: isHighlighted ? "brightness(1.4)" : undefined,
                animation: isExiting || isExited || isClearing
                  ? `bill-exit ${fadeDuration}ms ease-out forwards`
                  : undefined,
              }}
            >
              {bill.toLocaleString()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
