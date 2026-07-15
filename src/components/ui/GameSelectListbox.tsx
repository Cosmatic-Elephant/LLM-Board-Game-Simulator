"use client";

import { useRef } from "react";
import { useClickOutside } from "@/hooks/useClickOutside";

export interface GameOption {
  id: string;
  title: string;
  subtitle: string;
}

export const GAME_OPTIONS: GameOption[] = [
  { id: "las-vegas", title: "라스베가스", subtitle: "주사위를 굴려 카지노에 베팅하는 전략 보드게임" },
  { id: "yacht-dice", title: "요트 다이스", subtitle: "주사위 5개로 족보를 완성해 점수를 겨루는 보드게임" },
];

export function GameSelectListbox({
  selectedId,
  onSelect,
  onClose,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useClickOutside(ref, onClose);

  return (
    <div
      ref={ref}
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 bg-zinc-700 border border-zinc-600 rounded-lg shadow-xl overflow-hidden"
    >
      <div className="max-h-[300px] overflow-y-auto">
        {GAME_OPTIONS.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => {
              onSelect(g.id);
              onClose();
            }}
            className={`w-full px-3 py-2.5 text-left transition-colors ${
              g.id === selectedId ? "bg-yellow-500 text-black" : "text-white hover:bg-zinc-600"
            }`}
          >
            <div className="text-sm font-bold">{g.title}</div>
            <div className={`text-xs ${g.id === selectedId ? "text-black/70" : "text-gray-400"}`}>
              {g.subtitle}
            </div>
          </button>
        ))}
        <div className="w-full px-3 py-2.5 text-left text-zinc-500 cursor-not-allowed select-none">
          곧 새로운 게임이 추가됩니다...
        </div>
      </div>
    </div>
  );
}
