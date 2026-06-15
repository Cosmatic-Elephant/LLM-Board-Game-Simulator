"use client";

import type { Color, CasinoState } from "@/types/game";

const PLAYER_SQ: Record<Color, string> = {
  red:    "bg-red-500",
  yellow: "bg-yellow-400",
  green:  "bg-green-500",
  blue:   "bg-blue-500",
};

const BILL_STYLE: Record<number, string> = {
  10000:  "bg-slate-100  text-slate-800",
  20000:  "bg-green-100  text-green-800",
  30000:  "bg-sky-200    text-sky-800",
  40000:  "bg-blue-200   text-blue-900",
  50000:  "bg-violet-200 text-violet-900",
  60000:  "bg-amber-100  text-amber-800",
  70000:  "bg-lime-200   text-lime-800",
  80000:  "bg-orange-200 text-orange-900",
  90000:  "bg-yellow-200 text-yellow-900",
  100000: "bg-red-200    text-red-900",
};

const COLOR_ORDER: Color[] = ["red", "yellow", "green", "blue"];

interface CasinoProps {
  number: number;
  state: CasinoState;
  canPlace: boolean;   // visual: bright vs dark
  selectable: boolean; // functional: click enabled
  highlighted: boolean;
  onHover: (n: number | null) => void;
  onSelect?: () => void;
}

export function Casino({ number, state, canPlace, selectable, highlighted, onHover, onSelect }: CasinoProps) {
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
                return (
                  <div key={color} className="flex flex-wrap gap-0.5">
                    {Array.from({ length: count }, (_, i) => (
                      <div
                        key={i}
                        className={`w-3.5 h-3.5 rounded-sm ${PLAYER_SQ[color]}`}
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

      {/* ── Bills (overlapping stack, largest on top) ── */}
      <div className="flex flex-col gap-1">
        {state.bills.map((bill, i) => (
          <div
            key={i}
            className={[
              "px-2 py-0.5 text-xs font-mono font-semibold text-center rounded-sm select-none",
              BILL_STYLE[bill] ?? "bg-gray-200 text-gray-800",
            ].join(" ")}
          >
            {bill.toLocaleString()}
          </div>
        ))}
      </div>
    </div>
  );
}
