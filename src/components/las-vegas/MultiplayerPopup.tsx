"use client";

import { useState, useEffect } from "react";
import { DEFAULT_CUTOFF, DEFAULT_HUMAN_FIRST, DEFAULT_SLOT_COLORS, type ColorKey } from "@/lib/constants";
import { getSocket } from "@/lib/socket-client";
import type {
  ColorsUpdatePayload,
  CreateRoomAck,
  JoinRoomAck,
  ModelsUpdatePayload,
  RoomParticipant,
  RoomUpdatePayload,
} from "@/types/multiplayer";
import { PopupHeader } from "@/components/ui/PopupHeader";
import { MultiplayerRoomPopup } from "./MultiplayerRoomPopup";
import { STORAGE_MULTIPLAYER_NAME_KEY, DEFAULT_SLOT_MODELS } from "./constants";

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

export function MultiplayerPopup({ onClose }: { onClose: () => void }) {
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
