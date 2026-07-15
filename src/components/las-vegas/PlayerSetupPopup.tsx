"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_CUTOFF, DEFAULT_HUMAN_FIRST, PLAYER_COLORS, type ColorKey } from "@/lib/constants";
import { Toggle } from "@/components/ui/Toggle";
import { SelectField } from "@/components/ui/SelectField";
import { ColorSelect } from "./ColorSelect";
import {
  MODEL_OPTIONS,
  CUTOFF_OPTIONS,
  STORAGE_PLAYERS_KEY,
  STORAGE_SETTINGS_KEY,
  DEFAULT_PLAYERS,
  type PlayerSlot,
} from "./constants";

export function PlayerSetupPopup({ title, onClose }: { title: string; onClose: () => void }) {
  const router = useRouter();
  const [players, setPlayers] = useState<PlayerSlot[]>(() =>
    DEFAULT_PLAYERS.map((p) => ({ ...p }))
  );
  const [humanFirst, setHumanFirst] = useState(DEFAULT_HUMAN_FIRST);
  const [cutoff, setCutoff] = useState(DEFAULT_CUTOFF);

  const allAI = players.every((p) => p.isAI);

  // 팝업이 열릴 때 로컬스토리지에서 불러오기
  useEffect(() => {
    const saved = loadFromStorage();
    if (saved) {
      setPlayers(saved.players);
      setHumanFirst(saved.humanFirst);
      setCutoff(saved.cutoff);
    }
  }, []);

  // 설정 변경 시 자동 저장
  useEffect(() => {
    saveToStorage(players, humanFirst, cutoff, allAI);
  }, [players, humanFirst, cutoff, allAI]);

  function updatePlayer<K extends keyof PlayerSlot>(i: number, key: K, value: PlayerSlot[K]) {
    setPlayers((prev) => prev.map((p, idx) => (idx === i ? { ...p, [key]: value } : p)));
  }

  function handleResetToDefaults() {
    const defaultPlayers = DEFAULT_PLAYERS.map((p) => ({ ...p }));
    setPlayers(defaultPlayers);
    setHumanFirst(DEFAULT_HUMAN_FIRST);
    setCutoff(DEFAULT_CUTOFF);
    saveToStorage(defaultPlayers, DEFAULT_HUMAN_FIRST, DEFAULT_CUTOFF, false);
  }

  function handleStartGame() {
    const filled = players.map((p, i) =>
      !p.isAI && p.name.trim() === "" ? { ...p, name: `플레이어 ${i + 1}` } : p
    );

    const colorMeta = Object.fromEntries(PLAYER_COLORS.map((c) => [c.key, c]));
    const playerConfig = filled.map((p) => ({
      color: p.color,
      label: colorMeta[p.color].label,
      hex: colorMeta[p.color].hex,
      name: p.name,
      isLLM: p.isAI,
      modelId: p.isAI ? p.modelId : null,
    }));
    const gameSettings = {
      humanFirst: allAI ? false : humanFirst,
      cutline: cutoff,
    };

    localStorage.setItem(STORAGE_PLAYERS_KEY,  JSON.stringify(playerConfig));
    localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(gameSettings));

    router.push("/game");
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-800 border border-zinc-600 rounded-2xl p-6 flex flex-col gap-5 shadow-xl w-[480px] max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="font-bold text-white">{title}</span>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-lg leading-none transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Player slots */}
        <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-[6rem_1fr_3.5rem] gap-2">
            <span className="text-xs text-gray-400 text-center">색상</span>
            <span className="text-xs text-gray-400 text-center">플레이어</span>
            <span className="text-xs text-gray-400 text-center">AI</span>
          </div>
          {players.map((p, i) => {
            const takenKeys = players.filter((_, j) => j !== i).map((other) => other.color);
            return (
              <div key={i} className="grid grid-cols-[6rem_1fr_3.5rem] gap-2 items-center">
                <ColorSelect
                  value={p.color}
                  onChange={(v) => updatePlayer(i, "color", v)}
                  takenKeys={takenKeys}
                />

                {p.isAI ? (
                  <SelectField value={p.modelId} onChange={(v) => updatePlayer(i, "modelId", v)}>
                    {MODEL_OPTIONS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </SelectField>
                ) : (
                  <input
                    type="text"
                    value={p.name}
                    onChange={(e) => updatePlayer(i, "name", e.target.value)}
                    className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-400"
                  />
                )}

                <div className="flex justify-center">
                  <Toggle on={p.isAI} onToggle={() => updatePlayer(i, "isAI", !p.isAI)} />
                </div>
              </div>
            );
          })}
        </div>

        <hr className="border-zinc-600" />

        {/* Game settings */}
        <div className="flex flex-col gap-4">
          <span className="font-bold text-white">게임 설정</span>

          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">사람이 먼저 플레이</span>
            <Toggle on={humanFirst} onToggle={() => setHumanFirst((v) => !v)} disabled={allAI} />
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-gray-300 flex-shrink-0">지폐 배치 커트라인</span>
            <div className="w-44">
              <SelectField value={cutoff} onChange={(v) => setCutoff(Number(v))}>
                {CUTOFF_OPTIONS.map((v) => (
                  <option key={v} value={v}>
                    {v.toLocaleString()}
                  </option>
                ))}
              </SelectField>
            </div>
          </div>
        </div>

        {/* Bottom buttons */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={handleResetToDefaults}
            className="flex-1 py-2.5 bg-zinc-700 hover:bg-zinc-600 active:bg-zinc-800 rounded-xl text-sm font-bold text-white transition-colors"
          >
            기본값으로
          </button>
          <button className="flex-1 py-2.5 bg-zinc-700 hover:bg-zinc-600 active:bg-zinc-800 rounded-xl text-sm font-bold text-white transition-colors">
            튜토리얼
          </button>
          <button
            onClick={handleStartGame}
            className="flex-1 py-2.5 bg-yellow-500 hover:bg-yellow-400 active:bg-yellow-600 rounded-xl text-sm font-bold text-black transition-colors"
          >
            게임 시작
          </button>
        </div>
      </div>
    </div>
  );
}

function loadFromStorage(): { players: PlayerSlot[]; humanFirst: boolean; cutoff: number } | null {
  try {
    const rawPlayers  = localStorage.getItem(STORAGE_PLAYERS_KEY);
    const rawSettings = localStorage.getItem(STORAGE_SETTINGS_KEY);
    if (!rawPlayers || !rawSettings) return null;
    const raw = JSON.parse(rawPlayers) as Array<Record<string, unknown>>;
    // Normalize both lobby format (isAI) and game format (isLLM), and modelId: null
    const savedPlayers: PlayerSlot[] = raw.map((p) => ({
      color: (p.color as ColorKey) ?? "red",
      name: (p.name as string | undefined) ?? "",
      isAI: Boolean(p.isAI ?? p.isLLM),
      modelId: (p.modelId as string | null | undefined) ?? MODEL_OPTIONS[0].value,
    }));
    const savedSettings = JSON.parse(rawSettings) as { humanFirst: boolean; cutline: number };
    return { players: savedPlayers, humanFirst: savedSettings.humanFirst, cutoff: savedSettings.cutline };
  } catch {
    return null;
  }
}

function saveToStorage(players: PlayerSlot[], humanFirst: boolean, cutoff: number, allAI: boolean) {
  localStorage.setItem(STORAGE_PLAYERS_KEY,  JSON.stringify(players));
  localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify({
    humanFirst: allAI ? false : humanFirst,
    cutline: cutoff,
  }));
}
