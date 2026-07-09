"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_CUTOFF,
  DEFAULT_HUMAN_FIRST,
  DEFAULT_SLOT_COLORS,
  DEFAULT_SLOT_MODEL_ID,
  PLAYER_COLORS,
  type ColorKey,
} from "@/lib/constants";
import { getSocket } from "@/lib/socket-client";
import type {
  ColorsUpdatePayload,
  CreateRoomAck,
  JoinRoomAck,
  ModelsUpdatePayload,
  PlayerConfigEntry,
  RoomParticipant,
  RoomUpdatePayload,
  StartGamePayload,
} from "@/types/multiplayer";

const MODEL_OPTIONS = ["claude-sonnet-4-6", "gpt-4o", "gemini-pro", "깡통"] as const;
const CUTOFF_OPTIONS = [50000, 60000, 70000, 80000, 90000, 100000];

// 멀티플레이 방 슬롯(0~3번)이 아직 게스트가 입장하지 않은 "AI 슬롯"일 때의 기본 모델 배열.
const DEFAULT_SLOT_MODELS: string[] = Array(4).fill(DEFAULT_SLOT_MODEL_ID);

const STORAGE_PLAYERS_KEY  = "las-vegas:playerConfig";
const STORAGE_SETTINGS_KEY = "las-vegas:gameSettings";
const STORAGE_MULTIPLAYER_NAME_KEY = "las-vegas:multiplayerName";

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

function ColorDisplay({ value }: { value: ColorKey }) {
  const selected = PLAYER_COLORS.find((c) => c.key === value)!;
  return (
    <div className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white flex items-center gap-2">
      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: selected.hex }} />
      <span className="flex-1 text-left">{selected.label}</span>
    </div>
  );
}

function ReadOnlyBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white">
      {children}
    </div>
  );
}

function AIBadge({ on }: { on: boolean }) {
  return (
    <div
      className={[
        "w-12 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0",
        on ? "bg-yellow-500 text-black" : "bg-zinc-600",
      ].join(" ")}
    >
      {on ? "AI" : ""}
    </div>
  );
}

function PlayerSetupPopup({ title, onClose }: { title: string; onClose: () => void }) {
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

function PopupHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-bold text-white">{title}</span>
      <button
        onClick={onClose}
        className="text-gray-400 hover:text-white text-lg leading-none transition-colors"
      >
        ✕
      </button>
    </div>
  );
}

// 슬롯을 참가자 목록·색상·모델과 병합해 렌더링용 PlayerSlot 배열을 만든다.
// 참가자가 없는 슬롯은 AI 슬롯(isAI: true)으로, 있으면 사람 슬롯(isAI: false)으로 취급한다.
function mergeSlots(
  base: PlayerSlot[],
  participants: RoomParticipant[],
  colors: ColorKey[],
  models: string[]
): PlayerSlot[] {
  return base.map((p, i) => {
    const participant = participants.find((pt) => pt.slotIndex === i);
    return {
      ...p,
      name: participant ? participant.name : "",
      isAI: !participant,
      modelId: models[i] ?? p.modelId,
      color: colors[i] ?? p.color,
    };
  });
}

function MultiplayerRoomPopup({
  role,
  roomId,
  hostName,
  ownSlotIndex,
  participants,
  colors,
  onColorChange,
  models,
  onModelChange,
  humanFirst,
  cutoff,
  onHumanFirstChange,
  onCutoffChange,
  onClose,
}: {
  role: "host" | "guest";
  roomId: string;
  hostName: string;
  ownSlotIndex: number;
  participants: RoomParticipant[];
  colors: ColorKey[];
  onColorChange: (slotIndex: number, color: ColorKey) => void;
  models: string[];
  onModelChange: (slotIndex: number, modelId: string) => void;
  humanFirst: boolean;
  cutoff: number;
  onHumanFirstChange: (humanFirst: boolean) => void;
  onCutoffChange: (cutoff: number) => void;
  onClose: () => void;
}) {
  const isHost = role === "host";
  const router = useRouter();

  const [players, setPlayers] = useState<PlayerSlot[]>(() =>
    mergeSlots(DEFAULT_PLAYERS, participants, colors, models)
  );

  // 서버에서 참가자 목록/색상/모델이 갱신될 때마다(입장·퇴장·색상·모델 변경) 슬롯을 실시간으로 반영한다.
  useEffect(() => {
    setPlayers((prev) => mergeSlots(prev, participants, colors, models));
  }, [participants, colors, models]);

  // 호스트가 게임 시작을 누르면 서버가 모든 클라이언트(호스트 포함)에 game-started를 브로드캐스트한다.
  // 각 클라이언트는 이를 받아 싱글플레이 로비와 동일한 키로 sessionStorage에 저장한 뒤 /multi로 이동한다.
  useEffect(() => {
    const socket = getSocket();
    function handleGameStarted(data: StartGamePayload) {
      sessionStorage.setItem(STORAGE_PLAYERS_KEY, JSON.stringify(data.playerConfig));
      sessionStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(data.gameSettings));
      router.push("/multi");
    }
    socket.on("game-started", handleGameStarted);
    return () => {
      socket.off("game-started", handleGameStarted);
    };
  }, [router]);

  function handleResetToDefaults() {
    DEFAULT_SLOT_COLORS.forEach((color, i) => onColorChange(i, color));
    onHumanFirstChange(DEFAULT_HUMAN_FIRST);
    onCutoffChange(DEFAULT_CUTOFF);
  }

  async function handleCopyUrl() {
    const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${roomId}`;
    await navigator.clipboard.writeText(inviteUrl);
  }

  function handleStartGame() {
    const colorMeta = Object.fromEntries(PLAYER_COLORS.map((c) => [c.key, c]));
    const playerConfig: PlayerConfigEntry[] = players.map((p) => ({
      color: p.color,
      label: colorMeta[p.color].label,
      hex: colorMeta[p.color].hex,
      name: p.isAI ? "" : p.name,
      isLLM: p.isAI,
      modelId: p.isAI ? p.modelId : null,
    }));
    getSocket().emit("start-game", {
      playerConfig,
      gameSettings: { humanFirst, cutline: cutoff },
    });
  }

  const roomTitle = `${hostName}의 멀티플레이 방`;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-800 border border-zinc-600 rounded-2xl p-6 flex flex-col gap-5 shadow-xl w-[480px] max-h-[90vh] overflow-y-auto">
        <PopupHeader title={roomTitle} onClose={onClose} />

        {/* Player slots */}
        <div className="flex flex-col gap-2.5">
          <div className="grid grid-cols-[6rem_1fr_3.5rem] gap-2">
            <span className="text-xs text-gray-400 text-center">색상</span>
            <span className="text-xs text-gray-400 text-center">플레이어</span>
            <span className="text-xs text-gray-400 text-center">AI</span>
          </div>
          {players.map((p, i) => {
            const canEditColor = isHost || i === ownSlotIndex;
            const takenKeys = players.filter((_, j) => j !== i).map((other) => other.color);
            return (
              <div key={i} className="grid grid-cols-[6rem_1fr_3.5rem] gap-2 items-center">
                {canEditColor ? (
                  <ColorSelect
                    value={p.color}
                    onChange={(v) => onColorChange(i, v)}
                    takenKeys={takenKeys}
                  />
                ) : (
                  <ColorDisplay value={p.color} />
                )}

                {p.isAI ? (
                  isHost ? (
                    <SelectField value={p.modelId} onChange={(v) => onModelChange(i, v)}>
                      {MODEL_OPTIONS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </SelectField>
                  ) : (
                    <ReadOnlyBox>{p.modelId}</ReadOnlyBox>
                  )
                ) : (
                  <input
                    type="text"
                    value={p.name}
                    readOnly
                    className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white cursor-default focus:outline-none"
                  />
                )}

                <div className="flex justify-center">
                  <AIBadge on={p.isAI} />
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
            <Toggle on={humanFirst} onToggle={() => onHumanFirstChange(!humanFirst)} disabled={!isHost} />
          </div>

          <div className="flex items-center justify-between gap-4">
            <span className="text-sm text-gray-300 flex-shrink-0">지폐 배치 커트라인</span>
            <div className="w-44">
              {isHost ? (
                <SelectField value={cutoff} onChange={(v) => onCutoffChange(Number(v))}>
                  {CUTOFF_OPTIONS.map((v) => (
                    <option key={v} value={v}>
                      {v.toLocaleString()}
                    </option>
                  ))}
                </SelectField>
              ) : (
                <ReadOnlyBox>{cutoff.toLocaleString()}</ReadOnlyBox>
              )}
            </div>
          </div>
        </div>

        {/* Bottom buttons */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={handleResetToDefaults}
            disabled={!isHost}
            className="flex-1 py-2.5 bg-zinc-700 hover:bg-zinc-600 active:bg-zinc-800 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-zinc-700 disabled:active:bg-zinc-700"
          >
            기본값으로
          </button>
          <button
            onClick={handleCopyUrl}
            className="flex-1 py-2.5 bg-zinc-700 hover:bg-zinc-600 active:bg-zinc-800 rounded-xl text-sm font-bold text-white transition-colors"
          >
            URL 복사
          </button>
          <button
            onClick={handleStartGame}
            disabled={!isHost}
            className="flex-1 py-2.5 bg-yellow-500 hover:bg-yellow-400 active:bg-yellow-600 rounded-xl text-sm font-bold text-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-yellow-500 disabled:active:bg-yellow-500"
          >
            게임 시작
          </button>
        </div>
      </div>
    </div>
  );
}

// "https://.../?room=ABC123" 형태의 초대 URL 또는 방 코드를 그대로 입력한 경우 모두 처리한다.
function extractRoomId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.searchParams.get("room");
  } catch {
    return trimmed;
  }
}

function MultiplayerPopup({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<
    "entry" | "host-settings" | "guest-settings" | "not-found" | "host-left"
  >("entry");
  // 이 팝업은 버튼 클릭 후에만 마운트되므로(SSR 대상 아님) 로컬스토리지를 초기값에서 바로 읽어도 안전하다.
  // load/save를 분리된 effect 두 개로 처리하면 마운트 시점에 save effect가 default 값으로
  // 먼저 덮어써버리는 경합이 생길 수 있어(Strict Mode 이중 실행 시 특히), lazy init으로 회피한다.
  const [name, setName] = useState<string>(
    () => localStorage.getItem(STORAGE_MULTIPLAYER_NAME_KEY) ?? "플레이어"
  );
  const [roomUrl, setRoomUrl] = useState("");
  const [notFoundMessage, setNotFoundMessage] = useState("방을 찾을 수 없습니다.");

  const [roomId, setRoomId] = useState("");
  const [hostName, setHostName] = useState("");
  const [ownSlotIndex, setOwnSlotIndex] = useState(0);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [colors, setColors] = useState<ColorKey[]>([...DEFAULT_SLOT_COLORS]);
  const [models, setModels] = useState<string[]>([...DEFAULT_SLOT_MODELS]);
  const [humanFirst, setHumanFirst] = useState(DEFAULT_HUMAN_FIRST);
  const [cutoff, setCutoff] = useState(DEFAULT_CUTOFF);

  // 이름 변경 시 자동 저장
  useEffect(() => {
    localStorage.setItem(STORAGE_MULTIPLAYER_NAME_KEY, name);
  }, [name]);

  // 방의 참가자 목록/게임 설정이 바뀔 때마다(입장·퇴장·설정 변경) 서버가 브로드캐스트하는 room-update를 반영한다.
  useEffect(() => {
    const socket = getSocket();
    function handleRoomUpdate(data: RoomUpdatePayload) {
      setParticipants(data.participants);
      setHumanFirst(data.settings.humanFirst);
      setCutoff(data.settings.cutline);
    }
    socket.on("room-update", handleRoomUpdate);
    return () => {
      socket.off("room-update", handleRoomUpdate);
    };
  }, []);

  // 참가자 중 누군가 색상을 바꾸면 서버가 브로드캐스트하는 colors-update를 반영한다.
  useEffect(() => {
    const socket = getSocket();
    function handleColorsUpdate(data: ColorsUpdatePayload) {
      setColors(data.colors);
    }
    socket.on("colors-update", handleColorsUpdate);
    return () => {
      socket.off("colors-update", handleColorsUpdate);
    };
  }, []);

  // 참가자 중 누군가(호스트) AI 슬롯의 모델을 바꾸면 서버가 브로드캐스트하는 models-update를 반영한다.
  useEffect(() => {
    const socket = getSocket();
    function handleModelsUpdate(data: ModelsUpdatePayload) {
      setModels(data.models);
    }
    socket.on("models-update", handleModelsUpdate);
    return () => {
      socket.off("models-update", handleModelsUpdate);
    };
  }, []);

  // 호스트가 방을 나가면(퇴장 또는 연결 해제) 서버가 남은 게스트 전원에게 room-closed를 보낸다.
  useEffect(() => {
    const socket = getSocket();
    function handleRoomClosed() {
      setRoomId("");
      setHostName("");
      setOwnSlotIndex(0);
      setParticipants([]);
      setColors([...DEFAULT_SLOT_COLORS]);
      setModels([...DEFAULT_SLOT_MODELS]);
      setHumanFirst(DEFAULT_HUMAN_FIRST);
      setCutoff(DEFAULT_CUTOFF);
      setStep("host-left");
    }
    socket.on("room-closed", handleRoomClosed);
    return () => {
      socket.off("room-closed", handleRoomClosed);
    };
  }, []);

  // X 버튼으로 팝업을 닫을 때, 참여 중인 방이 있다면 서버에 명시적으로 퇴장을 알려 슬롯을 비운다.
  function handleClosePopup() {
    if (roomId) {
      getSocket().emit("leave-room");
    }
    onClose();
  }

  function handleColorChange(slotIndex: number, color: ColorKey) {
    getSocket().emit("update-color", { slotIndex, color });
  }

  function handleModelChange(slotIndex: number, modelId: string) {
    getSocket().emit("update-model", { slotIndex, modelId });
  }

  function handleHumanFirstChange(nextHumanFirst: boolean) {
    getSocket().emit("update-settings", { humanFirst: nextHumanFirst, cutline: cutoff });
  }

  function handleCutoffChange(nextCutoff: number) {
    getSocket().emit("update-settings", { humanFirst, cutline: nextCutoff });
  }

  function handleCreateRoom() {
    const socket = getSocket();
    socket.emit("create-room", { name }, (res: CreateRoomAck) => {
      setRoomId(res.roomId);
      setHostName(name);
      setOwnSlotIndex(0);
      setParticipants(res.participants);
      setColors(res.colors);
      setModels(res.models);
      setHumanFirst(res.settings.humanFirst);
      setCutoff(res.settings.cutline);
      setStep("host-settings");
    });
  }

  function handleJoinRoom() {
    const parsedRoomId = extractRoomId(roomUrl);
    if (!parsedRoomId) {
      setNotFoundMessage("방을 찾을 수 없습니다.");
      setStep("not-found");
      return;
    }
    const socket = getSocket();
    socket.emit("join-room", { roomId: parsedRoomId, name }, (res: JoinRoomAck) => {
      if (!res.ok) {
        setNotFoundMessage(res.error);
        setStep("not-found");
        return;
      }
      setRoomId(res.roomId);
      setHostName(res.hostName);
      setOwnSlotIndex(res.slotIndex);
      setParticipants(res.participants);
      setColors(res.colors);
      setModels(res.models);
      setHumanFirst(res.settings.humanFirst);
      setCutoff(res.settings.cutline);
      setStep("guest-settings");
    });
  }

  if (step === "host-settings") {
    return (
      <MultiplayerRoomPopup
        role="host"
        roomId={roomId}
        hostName={hostName}
        ownSlotIndex={ownSlotIndex}
        participants={participants}
        colors={colors}
        onColorChange={handleColorChange}
        models={models}
        onModelChange={handleModelChange}
        humanFirst={humanFirst}
        cutoff={cutoff}
        onHumanFirstChange={handleHumanFirstChange}
        onCutoffChange={handleCutoffChange}
        onClose={handleClosePopup}
      />
    );
  }

  if (step === "guest-settings") {
    return (
      <MultiplayerRoomPopup
        role="guest"
        roomId={roomId}
        hostName={hostName}
        ownSlotIndex={ownSlotIndex}
        participants={participants}
        colors={colors}
        onColorChange={handleColorChange}
        models={models}
        onModelChange={handleModelChange}
        humanFirst={humanFirst}
        cutoff={cutoff}
        onHumanFirstChange={handleHumanFirstChange}
        onCutoffChange={handleCutoffChange}
        onClose={handleClosePopup}
      />
    );
  }

  if (step === "not-found") {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-zinc-800 border border-zinc-600 rounded-2xl p-6 flex flex-col gap-5 shadow-xl w-[480px]">
          <PopupHeader title="멀티플레이" onClose={handleClosePopup} />
          <div className="flex flex-col items-center gap-5 py-4">
            <span className="text-sm text-gray-300">{notFoundMessage}</span>
            <button
              onClick={() => setStep("entry")}
              className="px-6 py-2.5 bg-zinc-700 hover:bg-zinc-600 active:bg-zinc-800 rounded-xl text-sm font-bold text-white transition-colors"
            >
              돌아가기
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === "host-left") {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
        <div className="bg-zinc-800 border border-zinc-600 rounded-2xl p-6 flex flex-col gap-5 shadow-xl w-[480px]">
          <div className="flex flex-col items-center gap-5 py-4">
            <span className="text-sm text-gray-300">호스트가 방을 이탈했습니다.</span>
            <button
              onClick={() => setStep("entry")}
              className="px-6 py-2.5 bg-yellow-500 hover:bg-yellow-400 active:bg-yellow-600 rounded-xl text-sm font-bold text-black transition-colors"
            >
              확인
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-zinc-800 border border-zinc-600 rounded-2xl p-6 flex flex-col gap-5 shadow-xl w-[480px]">
        <PopupHeader title="멀티플레이" onClose={handleClosePopup} />

        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-gray-400">이름</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-400"
          />
        </div>

        <hr className="border-zinc-600" />

        <div className="flex flex-col gap-3">
          <button
            onClick={handleCreateRoom}
            className="w-full py-2.5 bg-yellow-500 hover:bg-yellow-400 active:bg-yellow-600 rounded-xl text-sm font-bold text-black transition-colors"
          >
            방 만들기
          </button>

          <div className="flex gap-2">
            <input
              type="text"
              value={roomUrl}
              onChange={(e) => setRoomUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleJoinRoom(); }}
              placeholder="초대 URL 입력"
              className="flex-1 bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-400"
            />
            <button
              onClick={handleJoinRoom}
              className="px-4 py-2.5 bg-zinc-700 hover:bg-zinc-600 active:bg-zinc-800 rounded-xl text-sm font-bold text-white transition-colors"
            >
              참가하기
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LobbyPage() {
  const [activePopup, setActivePopup] = useState<"single" | "multi" | null>(null);

  return (
    <main className="relative flex flex-col items-center justify-center min-h-screen gap-4">
      <h1 className="text-4xl font-bold tracking-tight">Las Vegas Simulator</h1>
      <p className="text-gray-400">주사위를 굴려서 베팅하는 보드게임</p>
      <div className="mt-4 flex gap-4">
        <button
          onClick={() => setActivePopup("single")}
          className="px-8 py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-lg rounded-xl transition-colors"
        >
          싱글플레이
        </button>
        <button
          onClick={() => setActivePopup("multi")}
          className="px-8 py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-lg rounded-xl transition-colors"
        >
          멀티플레이
        </button>
      </div>

      <div className="absolute bottom-6">
        <button className="px-6 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-400 font-semibold text-sm rounded-xl transition-colors">
          게임 변경
        </button>
      </div>

      {activePopup === "single" && (
        <PlayerSetupPopup title="싱글 플레이어 설정" onClose={() => setActivePopup(null)} />
      )}
      {activePopup === "multi" && (
        <MultiplayerPopup onClose={() => setActivePopup(null)} />
      )}
    </main>
  );
}
