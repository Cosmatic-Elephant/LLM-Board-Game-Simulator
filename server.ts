import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { Server as SocketIOServer, type Socket } from "socket.io";
import {
  DEFAULT_CUTOFF,
  DEFAULT_HUMAN_FIRST,
  DEFAULT_SLOT_COLORS,
  DEFAULT_SLOT_MODEL_ID,
  type ColorKey,
} from "@/lib/constants";
import {
  MAX_ROOM_PLAYERS,
  type BetBubblePayload,
  type CreateRoomAck,
  type CreateRoomPayload,
  type GameSettings,
  type JoinRoomAck,
  type JoinRoomPayload,
  type PlaceBetPayload,
  type PlayerBubblePayload,
  type PlayerLeftPayload,
  type RequestGameStateAck,
  type RoomParticipant,
  type ScoringStepsPayload,
  type StartGamePayload,
  type TurnTimerPayload,
  type UpdateColorPayload,
  type UpdateModelPayload,
  type UpdateSettingsPayload,
} from "@/types/multiplayer";
import type { Action, CasinoNumber, CasinoState, GameState, PlayerConfig, PlayerState } from "@/types/game";
import { distributeRound } from "@/lib/bill-setup";
import {
  applyAction,
  applyRoll,
  applyScoring,
  buildLLMPayload,
  createInitialState,
  DICE_PER_PLAYER,
  getValidActions,
  isValidAction,
  rollDice,
} from "@/lib/game-engine";
import { getLLMAction, llmResponseToAction } from "@/lib/llm-client";
import { computeScoringSteps } from "@/lib/scoring";

const LLM_ROLL_DELAY_MS = 500;
const LLM_BET_DELAY_MS = 500;
// 사람 플레이어가 자기 턴(굴리기/베팅)에 행동하지 않을 때 서버가 대신 랜덤 행동을 실행하기까지의 유예 시간.
const HUMAN_TURN_TIMEOUT_MS = 15000;

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = parseInt(process.env.PORT ?? "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// 서버 내부 전용 참가자 표현. socketId는 연결 해제 시 슬롯을 찾기 위한 것으로, 클라이언트에는 보내지 않는다.
interface RoomParticipantInternal extends RoomParticipant {
  socketId: string;
}

interface Room {
  participants: RoomParticipantInternal[];
  colors: ColorKey[];
  models: string[];
  settings: GameSettings;
  started: boolean;
  gameState: GameState | null;
  // 라운드 종료 시 미리 계산해 둔 다음 라운드 카지노 배치. host가 next-round를 보낼 때 그대로 적용한다.
  // (distributeRound는 셔플에 따라 성공/실패가 갈릴 수 있어, 정산 시점에 한 번만 계산해 캐싱한다.)
  nextRoundPreview: { casinos: Record<CasinoNumber, CasinoState>; billDeck: number[] } | null;
  // 현재 사람 플레이어 턴 타임아웃 예약. AI 턴이거나 대기 중인 행동이 없으면 둘 다 null이다.
  turnTimer: ReturnType<typeof setTimeout> | null;
  turnDeadline: number | null;
}

// 방 코드에 헷갈리기 쉬운 문자(0/O, 1/I 등)를 제외한다.
const ROOM_ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateRoomId(rooms: Map<string, Room>): string {
  let id: string;
  do {
    id = Array.from({ length: 6 }, () => ROOM_ID_CHARS[Math.floor(Math.random() * ROOM_ID_CHARS.length)]).join("");
  } while (rooms.has(id));
  return id;
}

function toParticipantList(room: Room): RoomParticipant[] {
  return room.participants
    .map(({ slotIndex, name, isHost }) => ({ slotIndex, name, isHost }))
    .sort((a, b) => a.slotIndex - b.slotIndex);
}

// 어떤 색상을 조작할 권한이 있는 소켓인지 room.colors(슬롯→색상)와 room.participants(슬롯→소켓)를
// 조합해 구한다. AI 슬롯이거나 아직 아무도 입장하지 않은 슬롯의 색상이면 null을 반환한다.
function findColorOwnerSocketId(room: Room, color: ColorKey): string | null {
  const slotIndex = room.colors.indexOf(color);
  if (slotIndex === -1) return null;
  return room.participants.find((p) => p.slotIndex === slotIndex)?.socketId ?? null;
}

// 싱글플레이 game/page.tsx의 동명 함수와 동일한 알고리즘(Fisher-Yates + humanFirst 보정).
function shufflePlayers(players: PlayerState[], humanFirst: boolean): PlayerState[] {
  const arr = [...players];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  if (humanFirst && arr[0].isLLM) {
    const firstHumanIdx = arr.findIndex((p) => !p.isLLM);
    if (firstHumanIdx !== -1) {
      [arr[0], arr[firstHumanIdx]] = [arr[firstHumanIdx], arr[0]];
    }
  }
  return arr;
}

// 플레이어 구성·게임 설정으로 1라운드 초기 GameState를 만든다.
// createInitialState()/distributeRound()는 싱글플레이와 동일한 게임 엔진 함수를 재사용한다.
// start-game(로비에서 넘어온 구성)과 restart-game(진행 중이던 게임의 구성을 그대로 재사용) 양쪽에서 공유한다.
function buildGameStateFromConfigs(playerConfigs: PlayerConfig[], settings: GameSettings): GameState | null {
  const state = createInitialState(playerConfigs);
  const activeColors = state.players.map((p) => p.color);
  const dist = distributeRound(state.billDeck, activeColors, settings.cutline);
  if (!dist) return null;

  state.casinos = dist.casinos;
  state.billDeck = dist.remainingDeck;
  state.round = 1;
  state.turn = 0;
  state.players = shufflePlayers(state.players, settings.humanFirst);
  state.currentPlayerIndex = 0;
  state.phase = "rolling";
  state.currentRoll = null;
  state.lastAction = null;

  return state;
}

function buildInitialGameState(payload: StartGamePayload): GameState | null {
  const playerConfigs: PlayerConfig[] = payload.playerConfig.map((p, i) => ({
    color: p.color,
    isLLM: p.isLLM,
    name: p.isLLM ? (p.modelId ?? `AI ${i + 1}`) : (p.name.trim() || `플레이어 ${i + 1}`),
    modelId: p.modelId ?? undefined,
  }));

  return buildGameStateFromConfigs(playerConfigs, payload.gameSettings);
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const io = new SocketIOServer(httpServer);

  // 방 코드 → 방 상태, 소켓 id → 현재 참여 중인 방 코드 (연결 해제 시 정리용)
  const rooms = new Map<string, Room>();
  const socketRooms = new Map<string, string>();

  // 명시적 퇴장(leave-room)과 실제 연결 해제(disconnect) 양쪽에서 공유하는 정리 로직.
  // 로비 단계(room.started === false)와 게임 진행 중(room.started === true)은 서로 다른 정책을 쓰므로 분기한다.
  function removeParticipant(socket: Socket) {
    const roomId = socketRooms.get(socket.id);
    if (!roomId) return;
    socketRooms.delete(socket.id);

    const room = rooms.get(roomId);
    // socket.leave()를 emit보다 먼저 호출해, 이 소켓이 io.to(roomId) 대상에서 자연스럽게 제외되도록 한다.
    socket.leave(roomId);
    if (!room) return;

    const leaving = room.participants.find((p) => p.socketId === socket.id);
    if (!leaving) return;

    if (room.started) {
      handleParticipantLeaveDuringGame(roomId, room, socket.id, leaving);
      return;
    }

    // ── 로비 단계 ──
    // 호스트가 나가면 방 전체를 닫고 남은 게스트에게 room-closed를 알린 뒤 방을 삭제한다.
    // 게스트가 나가면 해당 슬롯만 비우고 나머지 참가자에게 room-update를 브로드캐스트한다.
    if (leaving.isHost) {
      console.log(`[Socket] 호스트 이탈로 방 종료: ${roomId}`);
      io.to(roomId).emit("room-closed");
      for (const p of room.participants) {
        if (p.socketId === socket.id) continue;
        socketRooms.delete(p.socketId);
        io.sockets.sockets.get(p.socketId)?.leave(roomId);
      }
      rooms.delete(roomId);
      return;
    }

    room.participants = room.participants.filter((p) => p.socketId !== socket.id);
    if (room.participants.length === 0) {
      rooms.delete(roomId);
      return;
    }
    io.to(roomId).emit("room-update", { participants: toParticipantList(room), settings: room.settings });
  }

  // 게임 진행 중(room.started) 참가자 이탈 시 호출된다.
  // 호스트 이탈: 남은 참가자만으로는 방을 유지할 이유가 없으므로 방을 삭제하고 host-left를 알린다.
  // 게스트 이탈: 슬롯을 깡통(AI)으로 대체해 게임을 계속 진행시키고, 이탈한 플레이어 이름을 함께 알린다.
  function handleParticipantLeaveDuringGame(
    roomId: string,
    room: Room,
    socketId: string,
    leaving: RoomParticipantInternal
  ) {
    if (leaving.isHost) {
      console.log(`[Socket] 게임 중 호스트 이탈로 방 종료: ${roomId}`);
      io.to(roomId).emit("host-left");
      clearTurnTimer(room);
      for (const p of room.participants) {
        if (p.socketId === socketId) continue;
        socketRooms.delete(p.socketId);
        io.sockets.sockets.get(p.socketId)?.leave(roomId);
      }
      rooms.delete(roomId);
      return;
    }

    room.participants = room.participants.filter((p) => p.socketId !== socketId);
    if (!room.gameState) return;

    const color = room.colors[leaving.slotIndex];
    const player = room.gameState.players.find((p) => p.color === color);
    if (!player) return;

    // 이탈한 플레이어가 마침 현재 턴을 쥐고 있었는지 미리 기억해 둔다 — 아니라면 다른 플레이어의
    // 이미 진행 중인 타이머/자동 진행을 이 이벤트 때문에 건드리면 안 된다(아래 참고).
    const wasCurrentTurn = room.gameState.players[room.gameState.currentPlayerIndex].color === color;

    const departedName = player.name ?? leaving.name;
    player.isLLM = true;
    player.modelId = DEFAULT_SLOT_MODEL_ID;
    player.name = DEFAULT_SLOT_MODEL_ID;
    room.models[leaving.slotIndex] = DEFAULT_SLOT_MODEL_ID;

    console.log(`[Socket] 게임 중 게스트 이탈로 깡통 대체: ${roomId} (${departedName} → ${color})`);
    const payload: PlayerLeftPayload = { color, name: departedName };
    io.to(roomId).emit("player-left", payload);
    io.to(roomId).emit("game-state", room.gameState);

    if (wasCurrentTurn) {
      // 지금까지는 사람이라 예약되지 않았던 자동 진행(봇 굴리기/베팅)과 턴 타이머 해제를 새로 걸어준다.
      // wasCurrentTurn이 아니면 currentPlayerIndex가 가리키는 플레이어는 이번 이탈과 무관하므로,
      // 이미 돌고 있는 그 플레이어의 타이머를 여기서 재시작시키지 않는다.
      scheduleLLMAutoRollIfNeeded(roomId);
      scheduleLLMAutoBetIfNeeded(roomId);
      scheduleTurnTimerIfNeeded(roomId);
    }
  }

  // 모든 플레이어의 주사위가 소진되어 phase가 "scoring"이 된 직후 호출한다.
  // applyScoring()으로 정산을 반영하고, 다음 라운드 배치를 미리 계산해 캐싱해 둔다.
  // 배치에 실패하면(지폐 부족) 그대로 게임 종료 상태로 전환한다.
  function handleRoundCompletion(roomId: string, room: Room) {
    if (!room.gameState) return;

    // applyScoring()이 casinos를 초기화하기 전에, 정산 연출에 필요한 카지노 보드(주사위·지폐)와
    // 단계별 이벤트를 미리 계산해 둔다. 클라이언트는 이 값으로 카지노 1번부터 순서대로 연출을 재생한다.
    const activeColors = room.gameState.players.map((p) => p.color);
    const preScoringCasinos = room.gameState.casinos;
    const scoringSteps = computeScoringSteps(preScoringCasinos, activeColors);

    const scored = applyScoring(room.gameState);

    const dist = distributeRound(scored.billDeck, activeColors, room.settings.cutline);

    if (dist) {
      room.nextRoundPreview = { casinos: dist.casinos, billDeck: dist.remainingDeck };
      scored.phase = "round-end";
    } else {
      room.nextRoundPreview = null;
      scored.phase = "game-end";
    }

    room.gameState = scored;

    const scoringPayload: ScoringStepsPayload = { casinos: preScoringCasinos, steps: scoringSteps };
    io.to(roomId).emit("scoring-steps", scoringPayload);
    io.to(roomId).emit("game-state", scored);
    // round-end/game-end 에는 대기 중인 행동이 없으므로 타이머는 항상 해제된다.
    scheduleTurnTimerIfNeeded(roomId);
  }

  function emitTurnTimer(roomId: string, deadline: number | null) {
    const payload: TurnTimerPayload = { deadline };
    io.to(roomId).emit("turn-timer", payload);
  }

  // 베팅 처리(사람 수동 베팅/LLM·깡통 자동 베팅/타임아웃 자동 베팅) 완료를 말풍선으로 알린다.
  // reasoning은 실제 LLM 응답이 있을 때만 넘기고, 그 외(깡통/사람/타임아웃)에는 빈 문자열을 보낸다.
  function emitBetBubble(
    roomId: string,
    color: ColorKey,
    casinoNumber: CasinoNumber,
    reasoning: string,
    isTimeout: boolean
  ) {
    const payload: BetBubblePayload = { color, casinoNumber, reasoning, isTimeout };
    io.to(roomId).emit("bet-bubble", payload);
  }

  function clearTurnTimer(room: Room) {
    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
    }
    room.turnDeadline = null;
  }

  // 현재 게임 상태를 보고 사람 플레이어가 대기 중인 행동(굴리기 또는 베팅)을 갖고 있으면 15초 타이머를
  // 새로 건다. 이전 타이머는 항상 먼저 취소하므로, 턴/행동이 바뀔 때마다 이 함수를 호출하는 것만으로
  // "취소 후 재시작" 규칙이 지켜진다. AI/깡통 턴이거나 대기 중인 행동이 없는 phase면 타이머 없이
  // deadline: null을 브로드캐스트해 클라이언트의 카운트다운도 함께 해제시킨다.
  function scheduleTurnTimerIfNeeded(roomId: string) {
    const room = rooms.get(roomId);
    if (!room) return;
    clearTurnTimer(room);

    const state = room.gameState;
    const pendingActionPhase = state?.phase === "rolling" || state?.phase === "awaiting-action";
    const player = state && pendingActionPhase ? state.players[state.currentPlayerIndex] : null;

    if (!player || player.isLLM) {
      emitTurnTimer(roomId, null);
      return;
    }

    const deadline = Date.now() + HUMAN_TURN_TIMEOUT_MS;
    room.turnDeadline = deadline;
    room.turnTimer = setTimeout(() => handleTurnTimeout(roomId), HUMAN_TURN_TIMEOUT_MS);
    emitTurnTimer(roomId, deadline);
  }

  // 사람 플레이어가 15초 안에 굴리기/베팅을 하지 않았을 때 깡통처럼 무작위 행동을 대신 실행한다.
  function handleTurnTimeout(roomId: string) {
    const room = rooms.get(roomId);
    if (!room) return;
    room.turnTimer = null;
    room.turnDeadline = null;

    const state = room.gameState;
    if (!state) return;
    const player = state.players[state.currentPlayerIndex];
    if (player.isLLM) return; // 안전장치 — 이 타이머는 항상 사람 턴에만 걸린다.

    if (state.phase === "rolling") {
      const roll = rollDice(player.diceRemaining);
      const nextState = applyRoll(state, roll);
      room.gameState = nextState;
      io.to(roomId).emit("game-state", nextState);

      const bubble: PlayerBubblePayload = { color: player.color, message: "시간 초과로 자동 행동했습니다." };
      io.to(roomId).emit("player-bubble", bubble);

      scheduleTurnTimerIfNeeded(roomId);
      return;
    }

    if (state.phase === "awaiting-action") {
      const roll = state.currentRoll;
      if (!roll) return;
      const validActions = getValidActions(roll);
      if (validActions.length === 0) return;
      const action = validActions[Math.floor(Math.random() * validActions.length)];

      const nextState = applyAction(state, action);
      room.gameState = nextState;
      // 타임아웃으로 대신 실행된 베팅 — reasoning 없음, isTimeout: true.
      emitBetBubble(roomId, player.color, action.casino, "", true);

      if (nextState.phase === "scoring") {
        handleRoundCompletion(roomId, room);
      } else {
        io.to(roomId).emit("game-state", nextState);
        scheduleLLMAutoRollIfNeeded(roomId);
        scheduleTurnTimerIfNeeded(roomId);
      }
    }
  }

  // 현재 턴 플레이어가 LLM/깡통이면 사람의 roll-dice 이벤트 없이 서버가 스스로 굴려서 진행한다.
  // 지연 후 다시 room을 조회해, 그 사이 상태가 바뀌었으면(다른 처리로 phase가 바뀐 경우) 취소한다.
  function scheduleLLMAutoRollIfNeeded(roomId: string) {
    const room = rooms.get(roomId);
    if (!room?.gameState || room.gameState.phase !== "rolling") return;
    if (!room.gameState.players[room.gameState.currentPlayerIndex].isLLM) return;

    setTimeout(() => {
      const latestRoom = rooms.get(roomId);
      if (!latestRoom?.gameState || latestRoom.gameState.phase !== "rolling") return;
      const player = latestRoom.gameState.players[latestRoom.gameState.currentPlayerIndex];
      if (!player.isLLM) return;

      const roll = rollDice(player.diceRemaining);
      const nextState = applyRoll(latestRoom.gameState, roll);
      latestRoom.gameState = nextState;
      io.to(roomId).emit("game-state", nextState);
      scheduleLLMAutoBetIfNeeded(roomId);
      scheduleTurnTimerIfNeeded(roomId);
    }, LLM_ROLL_DELAY_MS);
  }

  // LLM/깡통이 베팅할 행동을 결정한다. reasoning은 실제 LLM 응답에서 얻었을 때만 채워지고,
  // 단일 액션 최적화·깡통·폴백 경로에서는 항상 빈 문자열이다(말풍선에서 빈 값으로 취급).
  // 1) valid_actions가 하나뿐이면 API 호출 없이 즉시 그 행동을 선택한다(싱글플레이의 단일 액션 최적화와 동일).
  // 2) 모델이 "깡통"이면 기존처럼 유효한 행동 중 무작위로 고른다.
  // 3) 그 외(실제 LLM 모델)에는 buildLLMPayload()로 현재 상태를 JSON으로 구성해 getLLMAction()을 호출하고,
  //    isValidAction()으로 재검증한다. 호출 실패거나 valid_actions 밖의 응답이면 무작위 선택으로 폴백한다.
  async function decideBotAction(
    state: GameState,
    roll: number[],
    validActions: Action[],
    player: PlayerState
  ): Promise<{ action: Action; reasoning: string }> {
    if (validActions.length === 1) return { action: validActions[0], reasoning: "" };

    if (!player.modelId || player.modelId === DEFAULT_SLOT_MODEL_ID) {
      const action = validActions[Math.floor(Math.random() * validActions.length)];
      return { action, reasoning: "" };
    }

    try {
      const payload = buildLLMPayload(state, roll);
      const response = await getLLMAction(player.modelId, payload);
      const action = llmResponseToAction(response);

      if (!isValidAction(action, roll)) {
        throw new Error("LLM returned an action outside valid_actions");
      }
      return { action, reasoning: response.reasoning ?? "" };
    } catch (err) {
      console.error(`[LLM] ${player.color}(${player.modelId}) 행동 결정 실패 — 무작위로 대체:`, err);
      const action = validActions[Math.floor(Math.random() * validActions.length)];
      return { action, reasoning: "" };
    }
  }

  // 현재 턴 플레이어가 LLM/깡통이면 굴린 결과에 대해 서버가 스스로 베팅을 선택해 진행한다.
  function scheduleLLMAutoBetIfNeeded(roomId: string) {
    const room = rooms.get(roomId);
    if (!room?.gameState || room.gameState.phase !== "awaiting-action") return;
    if (!room.gameState.players[room.gameState.currentPlayerIndex].isLLM) return;

    setTimeout(async () => {
      const latestRoom = rooms.get(roomId);
      if (!latestRoom?.gameState || latestRoom.gameState.phase !== "awaiting-action") return;
      const player = latestRoom.gameState.players[latestRoom.gameState.currentPlayerIndex];
      if (!player.isLLM) return;
      const roll = latestRoom.gameState.currentRoll;
      if (!roll) return;

      const validActions = getValidActions(roll);
      if (validActions.length === 0) return;

      const { action, reasoning } = await decideBotAction(latestRoom.gameState, roll, validActions, player);

      // API 호출(비동기) 도중 방이 삭제되거나 다른 처리로 phase가 바뀌었을 수 있으니 최신 상태를 다시 확인한다.
      const roomAfterDecision = rooms.get(roomId);
      if (!roomAfterDecision?.gameState || roomAfterDecision.gameState.phase !== "awaiting-action") return;

      const nextState = applyAction(roomAfterDecision.gameState, action);
      roomAfterDecision.gameState = nextState;
      emitBetBubble(roomId, player.color, action.casino, reasoning, false);

      if (nextState.phase === "scoring") {
        handleRoundCompletion(roomId, roomAfterDecision);
      } else {
        io.to(roomId).emit("game-state", nextState);
        scheduleLLMAutoRollIfNeeded(roomId);
        scheduleTurnTimerIfNeeded(roomId);
      }
    }, LLM_BET_DELAY_MS);
  }

  io.on("connection", (socket) => {
    console.log(`[Socket] 클라이언트 연결됨: ${socket.id}`);

    socket.on("create-room", (payload: CreateRoomPayload, callback: (res: CreateRoomAck) => void) => {
      const roomId = generateRoomId(rooms);
      const room: Room = {
        participants: [{ socketId: socket.id, slotIndex: 0, name: payload.name, isHost: true }],
        colors: [...DEFAULT_SLOT_COLORS],
        models: Array(MAX_ROOM_PLAYERS).fill(DEFAULT_SLOT_MODEL_ID),
        settings: { humanFirst: DEFAULT_HUMAN_FIRST, cutline: DEFAULT_CUTOFF },
        started: false,
        gameState: null,
        nextRoundPreview: null,
        turnTimer: null,
        turnDeadline: null,
      };
      rooms.set(roomId, room);
      socketRooms.set(socket.id, roomId);
      socket.join(roomId);

      console.log(`[Socket] 방 생성됨: ${roomId} (호스트: ${payload.name})`);
      callback({
        roomId,
        participants: toParticipantList(room),
        colors: room.colors,
        models: room.models,
        settings: room.settings,
      });
    });

    socket.on("join-room", (payload: JoinRoomPayload, callback: (res: JoinRoomAck) => void) => {
      const room = rooms.get(payload.roomId);
      if (!room) {
        callback({ ok: false, error: "방을 찾을 수 없습니다." });
        return;
      }
      if (room.started) {
        callback({ ok: false, error: "게임이 진행 중입니다." });
        return;
      }

      const takenSlots = new Set(room.participants.map((p) => p.slotIndex));
      let slotIndex = -1;
      for (let i = 0; i < MAX_ROOM_PLAYERS; i++) {
        if (!takenSlots.has(i)) {
          slotIndex = i;
          break;
        }
      }
      if (slotIndex === -1) {
        callback({ ok: false, error: "방이 꽉 찼습니다." });
        return;
      }

      room.participants.push({ socketId: socket.id, slotIndex, name: payload.name, isHost: false });
      socketRooms.set(socket.id, payload.roomId);
      socket.join(payload.roomId);

      const hostName = room.participants.find((p) => p.isHost)?.name ?? "";
      const participants = toParticipantList(room);

      console.log(`[Socket] ${payload.name}님이 방 ${payload.roomId}에 참가함 (슬롯 ${slotIndex})`);
      callback({
        ok: true,
        roomId: payload.roomId,
        hostName,
        slotIndex,
        participants,
        colors: room.colors,
        models: room.models,
        settings: room.settings,
      });
      io.to(payload.roomId).emit("room-update", { participants, settings: room.settings });
    });

    socket.on("update-color", (payload: UpdateColorPayload) => {
      const roomId = socketRooms.get(socket.id);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      if (payload.slotIndex < 0 || payload.slotIndex >= MAX_ROOM_PLAYERS) return;

      room.colors[payload.slotIndex] = payload.color;
      io.to(roomId).emit("colors-update", { colors: room.colors });
    });

    socket.on("update-model", (payload: UpdateModelPayload) => {
      const roomId = socketRooms.get(socket.id);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      if (payload.slotIndex < 0 || payload.slotIndex >= MAX_ROOM_PLAYERS) return;

      room.models[payload.slotIndex] = payload.modelId;
      io.to(roomId).emit("models-update", { models: room.models });
    });

    socket.on("update-settings", (payload: UpdateSettingsPayload) => {
      const roomId = socketRooms.get(socket.id);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;

      room.settings = payload;
      io.to(roomId).emit("room-update", { participants: toParticipantList(room), settings: room.settings });
    });

    socket.on("start-game", (payload: StartGamePayload) => {
      const roomId = socketRooms.get(socket.id);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      const participant = room.participants.find((p) => p.socketId === socket.id);
      if (!participant?.isHost) return;

      room.started = true;
      console.log(`[Socket] 게임 시작: ${roomId}`);
      io.to(roomId).emit("game-started", payload);

      const gameState = buildInitialGameState(payload);
      room.gameState = gameState;
      if (gameState) {
        io.to(roomId).emit("game-state", gameState);
        scheduleLLMAutoRollIfNeeded(roomId);
        scheduleTurnTimerIfNeeded(roomId);
      } else {
        console.error(`[Socket] 초기 게임 상태 생성 실패(지폐 부족): ${roomId}`);
      }
    });

    socket.on("roll-dice", () => {
      const roomId = socketRooms.get(socket.id);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room?.gameState) return;
      if (room.gameState.phase !== "rolling") return;

      const currentPlayer = room.gameState.players[room.gameState.currentPlayerIndex];
      if (findColorOwnerSocketId(room, currentPlayer.color) !== socket.id) return;

      const roll = rollDice(currentPlayer.diceRemaining);
      const nextState = applyRoll(room.gameState, roll);
      room.gameState = nextState;
      io.to(roomId).emit("game-state", nextState);
      // 굴리기 완료 — 이제 베팅을 기다려야 하므로 타이머를 새로 건다(이전 타이머는 자동 취소됨).
      scheduleTurnTimerIfNeeded(roomId);
    });

    socket.on("place-bet", (payload: PlaceBetPayload) => {
      const roomId = socketRooms.get(socket.id);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room?.gameState) return;
      if (room.gameState.phase !== "awaiting-action") return;

      const currentPlayer = room.gameState.players[room.gameState.currentPlayerIndex];
      if (findColorOwnerSocketId(room, currentPlayer.color) !== socket.id) return;

      const roll = room.gameState.currentRoll;
      if (!roll) return;
      const action = getValidActions(roll).find((a) => a.casino === payload.casino);
      if (!action) return; // 굴린 눈에 해당하지 않는 카지노 선택은 무시

      const nextState = applyAction(room.gameState, action);
      room.gameState = nextState;
      // 사람 플레이어의 수동 베팅 — reasoning 없음, 타임아웃 아님.
      emitBetBubble(roomId, currentPlayer.color, action.casino, "", false);

      if (nextState.phase === "scoring") {
        // 전원 주사위 소진 — 정산 + 다음 라운드 배치 시도까지 한 번에 처리한다.
        handleRoundCompletion(roomId, room);
        return;
      }

      io.to(roomId).emit("game-state", nextState);
      // applyAction()이 이미 다음 플레이어로 턴을 넘겼으므로(주사위 없는 플레이어는 자동 스킵),
      // 다음 차례가 LLM/깡통이면 서버가 이어서 자동으로 굴린다.
      scheduleLLMAutoRollIfNeeded(roomId);
      scheduleTurnTimerIfNeeded(roomId);
    });

    // 호스트가 정산 연출 스킵을 요청하면, 방 전체에 그대로 전달한다. 정산 데이터(점수·다음 라운드 배치)는
    // 이미 handleRoundCompletion에서 확정돼 있으므로 서버는 상태를 바꿀 필요 없이 알리기만 하면 된다.
    socket.on("skip-scoring", () => {
      const roomId = socketRooms.get(socket.id);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      const participant = room.participants.find((p) => p.socketId === socket.id);
      if (!participant?.isHost) return;

      io.to(roomId).emit("scoring-skipped");
    });

    socket.on("next-round", () => {
      const roomId = socketRooms.get(socket.id);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room?.gameState || !room.nextRoundPreview) return;
      if (room.gameState.phase !== "round-end") return;

      const participant = room.participants.find((p) => p.socketId === socket.id);
      if (!participant?.isHost) return;

      const preview = room.nextRoundPreview;
      const shuffledPlayers = shufflePlayers(
        room.gameState.players.map((p) => ({ ...p, diceRemaining: DICE_PER_PLAYER })),
        room.settings.humanFirst
      );

      const nextState: GameState = {
        ...room.gameState,
        casinos: preview.casinos,
        billDeck: preview.billDeck,
        round: room.gameState.round + 1,
        turn: 0,
        players: shuffledPlayers,
        currentPlayerIndex: 0,
        phase: "rolling",
        currentRoll: null,
        lastAction: null,
      };

      room.nextRoundPreview = null;
      room.gameState = nextState;
      console.log(`[Socket] 다음 라운드 시작: ${roomId} (round ${nextState.round})`);
      io.to(roomId).emit("game-state", nextState);
      scheduleLLMAutoRollIfNeeded(roomId);
      scheduleTurnTimerIfNeeded(roomId);
    });

    // 호스트가 명시적으로 게임을 종료할 때. 전원에게 game-ended를 알리고 방을 완전히 삭제한다.
    socket.on("end-game", () => {
      const roomId = socketRooms.get(socket.id);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      const participant = room.participants.find((p) => p.socketId === socket.id);
      if (!participant?.isHost) return;

      console.log(`[Socket] 호스트가 게임을 종료함: ${roomId}`);
      io.to(roomId).emit("game-ended");
      clearTurnTimer(room);
      for (const p of room.participants) {
        socketRooms.delete(p.socketId);
        io.sockets.sockets.get(p.socketId)?.leave(roomId);
      }
      rooms.delete(roomId);
    });

    // 호스트가 게임 종료 화면에서 "다시하기"를 누르면, 진행 중이던(혹은 방금 끝난) 게임의 플레이어
    // 구성(색상·isLLM·이름·모델)을 그대로 재사용해 소지금·지폐·순서를 전부 초기화한 새 게임을 만든다.
    socket.on("restart-game", () => {
      const roomId = socketRooms.get(socket.id);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room?.gameState) return;
      const participant = room.participants.find((p) => p.socketId === socket.id);
      if (!participant?.isHost) return;

      const playerConfigs: PlayerConfig[] = room.gameState.players.map((p) => ({
        color: p.color,
        isLLM: p.isLLM,
        name: p.name,
        modelId: p.modelId,
      }));

      const gameState = buildGameStateFromConfigs(playerConfigs, room.settings);
      clearTurnTimer(room);
      room.nextRoundPreview = null;
      room.gameState = gameState;

      if (gameState) {
        console.log(`[Socket] 다시하기: ${roomId}`);
        io.to(roomId).emit("game-state", gameState);
        scheduleLLMAutoRollIfNeeded(roomId);
        scheduleTurnTimerIfNeeded(roomId);
      } else {
        console.error(`[Socket] 다시하기 게임 상태 생성 실패(지폐 부족): ${roomId}`);
      }
    });

    // /multi 페이지는 로비에서 방에 join된 소켓을 그대로 재사용하지만, game-started/game-state
    // 브로드캐스트는 host의 start-game 처리 직후 즉시 나가므로 아직 마운트되지 않은 페이지는
    // 이를 놓칠 수 있다. 마운트 시 이 이벤트로 현재 방의 게임 상태를 명시적으로 다시 요청한다.
    socket.on("request-game-state", (callback: (res: RequestGameStateAck) => void) => {
      const roomId = socketRooms.get(socket.id);
      const room = roomId ? rooms.get(roomId) : undefined;
      if (!room) {
        callback({ gameState: null, myColor: null, isHost: false, turnDeadline: null });
        return;
      }
      const participant = room.participants.find((p) => p.socketId === socket.id);
      const myColor = participant ? room.colors[participant.slotIndex] ?? null : null;
      callback({
        gameState: room.gameState,
        myColor,
        isHost: participant?.isHost ?? false,
        turnDeadline: room.turnDeadline,
      });
    });

    socket.on("leave-room", () => {
      console.log(`[Socket] 클라이언트가 방을 나감: ${socket.id}`);
      removeParticipant(socket);
    });

    socket.on("disconnect", () => {
      console.log(`[Socket] 클라이언트 연결 해제: ${socket.id}`);
      removeParticipant(socket);
    });
  });

  httpServer.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
