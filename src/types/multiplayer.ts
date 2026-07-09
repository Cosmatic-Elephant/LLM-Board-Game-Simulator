// 로비 멀티플레이 룸 생성/참가에 사용하는 Socket.io 이벤트 페이로드 타입.
// server.ts(루트)와 src/app/page.tsx 양쪽에서 공유한다.

import type { ColorKey } from "@/lib/constants";

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
