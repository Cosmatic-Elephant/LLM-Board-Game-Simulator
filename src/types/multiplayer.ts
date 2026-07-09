// 로비 멀티플레이 룸 생성/참가에 사용하는 Socket.io 이벤트 페이로드 타입.
// server.ts(루트)와 src/app/page.tsx 양쪽에서 공유한다.

import type { ColorKey } from "@/lib/constants";
import type { CasinoNumber, GameState } from "@/types/game";

export const MAX_ROOM_PLAYERS = 4;

export interface RoomParticipant {
  slotIndex: number;
  name: string;
  isHost: boolean;
}

export interface GameSettings {
  humanFirst: boolean;
  cutline: number;
}

export interface CreateRoomPayload {
  name: string;
}

export interface CreateRoomAck {
  roomId: string;
  participants: RoomParticipant[];
  colors: ColorKey[];
  models: string[];
  settings: GameSettings;
}

export interface JoinRoomPayload {
  roomId: string;
  name: string;
}

export type JoinRoomAck =
  | {
      ok: true;
      roomId: string;
      hostName: string;
      slotIndex: number;
      participants: RoomParticipant[];
      colors: ColorKey[];
      models: string[];
      settings: GameSettings;
    }
  | { ok: false; error: string };

export interface RoomUpdatePayload {
  participants: RoomParticipant[];
  settings: GameSettings;
}

export interface UpdateColorPayload {
  slotIndex: number;
  color: ColorKey;
}

export interface ColorsUpdatePayload {
  colors: ColorKey[];
}

export interface UpdateModelPayload {
  slotIndex: number;
  modelId: string;
}

export interface ModelsUpdatePayload {
  models: string[];
}

export type UpdateSettingsPayload = GameSettings;

// las-vegas:playerConfig에 저장되는 형태와 1:1 대응 (싱글플레이 로비 포맷과 동일).
export interface PlayerConfigEntry {
  color: ColorKey;
  label: string;
  hex: string;
  name: string;
  isLLM: boolean;
  modelId: string | null;
}

export interface StartGamePayload {
  playerConfig: PlayerConfigEntry[];
  gameSettings: GameSettings;
}

// 마운트 시 현재 방의 게임 상태를 명시적으로 요청할 때의 응답. myColor는 이 소켓이
// 조작 가능한 플레이어 색상(게임 미시작이거나 AI 슬롯 소유가 아니면 null)이다.
export interface RequestGameStateAck {
  gameState: GameState | null;
  myColor: ColorKey | null;
  isHost: boolean;
}

export interface PlaceBetPayload {
  casino: CasinoNumber;
}
