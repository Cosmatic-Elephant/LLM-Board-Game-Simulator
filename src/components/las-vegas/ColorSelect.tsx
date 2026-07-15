"use client";

import { useRef, useState } from "react";
import { PLAYER_COLORS, type ColorKey } from "@/lib/constants";
import { useClickOutside } from "@/hooks/useClickOutside";

export function ColorSelect({
  value,
  onChange,
  takenKeys,
}: {
  value: ColorKey;
  onChange: (key: ColorKey) => void;
  takenKeys: ColorKey[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = PLAYER_COLORS.find((c) => c.key === value)!;

  useClickOutside(ref, () => setOpen(false), open);

  return (
    <div ref={ref} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full bg-zinc-700 border border-zinc-600 rounded-lg pl-3 pr-8 py-2 text-sm text-white flex items-center gap-2 focus:outline-none focus:border-zinc-400"
      >
        <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: selected.hex }} />
        <span className="flex-1 text-left">{selected.label}</span>
        <span className="absolute right-2.5 text-gray-400 text-xs pointer-events-none">▽</span>
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-zinc-700 border border-zinc-600 rounded-lg shadow-xl z-20 overflow-hidden">
          {PLAYER_COLORS.map((c) => {
            const isTaken = c.key !== value && takenKeys.includes(c.key as ColorKey);
            return (
              <button
                key={c.key}
                type="button"
                disabled={isTaken}
                onClick={() => {
                  onChange(c.key as ColorKey);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                  isTaken
                    ? "text-zinc-500 cursor-not-allowed"
                    : "text-white hover:bg-zinc-600 cursor-pointer"
                }`}
              >
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: c.hex, opacity: isTaken ? 0.3 : 1 }}
                />
                {c.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
