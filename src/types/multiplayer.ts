// 로비 멀티플레이 룸 생성/참가에 사용하는 Socket.io 이벤트 페이로드 타입.
// server.ts(루트)와 src/app/page.tsx 양쪽에서 공유한다.

import type { ColorKey } from "@/lib/constants";
import type { CasinoNumber, CasinoState, GameState, ScoringStep } from "@/types/game";

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
// turnDeadline은 현재 사람 플레이어의 턴 타임아웃 마감 시각(epoch ms), 타이머가 없으면 null이다.
export interface RequestGameStateAck {
  gameState: GameState | null;
  myColor: ColorKey | null;
  isHost: boolean;
  turnDeadline: number | null;
}

export interface PlaceBetPayload {
  casino: CasinoNumber;
}

// 게임 진행 중 게스트가 이탈해 해당 슬롯이 깡통(AI)으로 대체될 때 브로드캐스트되는 페이로드.
export interface PlayerLeftPayload {
  color: ColorKey;
  name: string;
}

// 현재 사람 플레이어의 턴 타임아웃(15초) 마감 시각. 새 턴/행동마다 갱신되고,
// AI/깡통 턴이거나 대기 중인 행동이 없으면 deadline이 null로 브로드캐스트된다.
// 클라이언트는 이 값을 기준으로 남은 시간을 직접 계산해(setInterval) 카운트다운을 동기화한다.
export interface TurnTimerPayload {
  deadline: number | null;
}

// 사람 플레이어가 15초 안에 행동하지 않아 서버가 대신 랜덤 행동을 실행했을 때, 말풍선에 표시할 메시지.
// (베팅이 아닌 굴리기 타임아웃 등 casinoNumber가 없는 경우에 쓰인다. 베팅 완료는 BetBubblePayload를 쓴다.)
export interface PlayerBubblePayload {
  color: ColorKey;
  message: string;
}

// 베팅 처리(사람 수동 베팅 / LLM·깡통 자동 베팅 / 타임아웃 자동 베팅) 완료 시 함께 브로드캐스트되는 말풍선 정보.
// reasoning은 실제 LLM 모델이 응답한 근거 텍스트일 때만 채워지고, 깡통/사람 플레이어는 빈 문자열이다.
export interface BetBubblePayload {
  color: ColorKey;
  casinoNumber: CasinoNumber;
  reasoning?: string;
  isTimeout?: boolean;
}

// 라운드 종료(applyScoring 직전) 시 정산 연출에 필요한 데이터를 함께 브로드캐스트한다.
// casinos는 정산으로 초기화되기 "전"의 카지노 보드(주사위·지폐)를 그대로 담아, 클라이언트가 연출 내내
// 화면에 표시할 수 있게 한다. steps는 computeScoringSteps()의 결과(카지노별 순위 이벤트 + 최종 델타)이다.
// 이 이벤트는 곧바로 이어지는 round-end/game-end game-state 브로드캐스트보다 항상 먼저 전송된다.
export interface ScoringStepsPayload {
  casinos: Record<CasinoNumber, CasinoState>;
  steps: ScoringStep[];
}
