"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_CUTOFF, DEFAULT_HUMAN_FIRST, DEFAULT_SLOT_COLORS, PLAYER_COLORS, type ColorKey } from "@/lib/constants";
import { getSocket } from "@/lib/socket-client";
import type { PlayerConfigEntry, RoomParticipant } from "@/types/multiplayer";
import { PopupHeader } from "@/components/ui/PopupHeader";
import { Toggle } from "@/components/ui/Toggle";
import { SelectField } from "@/components/ui/SelectField";
import { ReadOnlyBox } from "@/components/ui/ReadOnlyBox";
import { ColorSelect } from "./ColorSelect";
import { ColorDisplay } from "./ColorDisplay";
import { AIBadge } from "./AIBadge";
import { MODEL_OPTIONS, CUTOFF_OPTIONS, DEFAULT_PLAYERS, type PlayerSlot } from "./constants";

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

export function MultiplayerRoomPopup({
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
  // /multi 페이지는 게임 상태를 sessionStorage가 아니라 소켓(request-game-state/game-state)으로 받아오므로
  // 여기서는 페이지 이동만 하면 된다. 예전에는 싱글플레이 로비와 같은 키로 sessionStorage에도 저장했었는데,
  // /multi가 이를 전혀 읽지 않으면서도 game/page.tsx의 sessionStorage-우선 폴백만 오염시켜 — 멀티플레이를
  // 한 번 하고 나면 그 탭에서 여는 싱글플레이가 계속 그 값을 넘겨받는 버그로 이어졌다.
  useEffect(() => {
    const socket = getSocket();
    function handleGameStarted() {
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
                        <option key={m.value} value={m.value}>
                          {m.label}
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
