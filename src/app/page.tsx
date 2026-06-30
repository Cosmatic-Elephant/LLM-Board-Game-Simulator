"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PLAYER_COLORS, type ColorKey } from "@/lib/constants";

const MODEL_OPTIONS = ["claude-sonnet-4-6", "gpt-4o", "gemini-pro", "깡통"] as const;
const CUTOFF_OPTIONS = [50000, 60000, 70000, 80000, 90000, 100000];

const STORAGE_PLAYERS_KEY  = "las-vegas:playerConfig";
const STORAGE_SETTINGS_KEY = "las-vegas:gameSettings";

interface PlayerSlot {
  color: ColorKey;
  name: string;
  isAI: boolean;
  modelId: string;
}

const DEFAULT_PLAYERS: PlayerSlot[] = [
  { color: "red",    name: "플레이어 1", isAI: false, modelId: "claude-sonnet-4-6" },
  { color: "yellow", name: "플레이어 2", isAI: false, modelId: "claude-sonnet-4-6" },
  { color: "green",  name: "플레이어 3", isAI: false, modelId: "claude-sonnet-4-6" },
  { color: "blue",   name: "플레이어 4", isAI: false, modelId: "claude-sonnet-4-6" },
];
const DEFAULT_HUMAN_FIRST = true;
const DEFAULT_CUTOFF      = 50000;

function Toggle({ on, onToggle, disabled = false }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={[
        "relative w-12 h-6 rounded-full transition-colors flex-shrink-0",
        disabled ? "opacity-35 cursor-not-allowed" : "",
        on ? "bg-yellow-500" : "bg-zinc-600",
      ].join(" ")}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? "translate-x-6" : "translate-x-0"}`}
      />
    </button>
  );
}

function SelectField({
  value,
  onChange,
  children,
}: {
  value: string | number;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative w-full">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-700 border border-zinc-600 rounded-lg pl-3 pr-8 py-2 text-sm text-white appearance-none cursor-pointer focus:outline-none focus:border-zinc-400"
      >
        {children}
      </select>
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 text-xs">
        ▽
      </span>
    </div>
  );
}

function ColorSelect({
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

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

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
      modelId: (p.modelId as string | null | undefined) ?? MODEL_OPTIONS[0],
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

export default function LobbyPage() {
  const router = useRouter();
  const [showPopup, setShowPopup] = useState(false);
  const mouseDownOutsideRef = useRef(false);
  const [players, setPlayers] = useState<PlayerSlot[]>(() =>
    DEFAULT_PLAYERS.map((p) => ({ ...p }))
  );
  const [humanFirst, setHumanFirst] = useState(DEFAULT_HUMAN_FIRST);
  const [cutoff, setCutoff] = useState(DEFAULT_CUTOFF);

  const allAI = players.every((p) => p.isAI);

  // 팝업이 열릴 때 로컬스토리지에서 불러오기
  useEffect(() => {
    if (!showPopup) return;
    const saved = loadFromStorage();
    if (saved) {
      setPlayers(saved.players);
      setHumanFirst(saved.humanFirst);
      setCutoff(saved.cutoff);
    }
  }, [showPopup]);

  // 설정 변경 시 자동 저장
  useEffect(() => {
    if (!showPopup) return;
    saveToStorage(players, humanFirst, cutoff, allAI);
  }, [players, humanFirst, cutoff, allAI, showPopup]);

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
    <main className="flex flex-col items-center justify-center min-h-screen gap-4">
      <h1 className="text-4xl font-bold tracking-tight">Las Vegas Simulator</h1>
      <p className="text-gray-400">주사위를 굴려서 베팅하는 보드게임</p>
      <div className="mt-4 flex gap-4">
        <button className="px-8 py-3 bg-gray-600 hover:bg-gray-500 text-white font-bold text-lg rounded-xl transition-colors">
          게임 변경
        </button>
        <button
          onClick={() => setShowPopup(true)}
          className="px-8 py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-lg rounded-xl transition-colors"
        >
          게임 시작
        </button>
      </div>

      {showPopup && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onMouseDown={() => { mouseDownOutsideRef.current = true; }}
          onMouseUp={() => {
            if (mouseDownOutsideRef.current) setShowPopup(false);
            mouseDownOutsideRef.current = false;
          }}
        >
          <div
            className="bg-zinc-800 border border-zinc-600 rounded-2xl p-6 flex flex-col gap-5 shadow-xl w-[480px] max-h-[90vh] overflow-y-auto"
            onMouseDown={(e) => { e.stopPropagation(); mouseDownOutsideRef.current = false; }}
            onMouseUp={(e) => { e.stopPropagation(); }}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="font-bold text-white">플레이어 설정</span>
              <button
                onClick={() => setShowPopup(false)}
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
                          <option key={m} value={m}>
                            {m}
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
      )}
    </main>
  );
}
