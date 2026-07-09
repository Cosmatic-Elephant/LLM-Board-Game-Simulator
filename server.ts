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
  type CreateRoomAck,
  type CreateRoomPayload,
  type GameSettings,
  type JoinRoomAck,
  type JoinRoomPayload,
  type PlaceBetPayload,
  type RequestGameStateAck,
  type RoomParticipant,
  type StartGamePayload,
  type UpdateColorPayload,
  type UpdateModelPayload,
  type UpdateSettingsPayload,
} from "@/types/multiplayer";
import type { CasinoNumber, CasinoState, GameState, PlayerConfig, PlayerState } from "@/types/game";
import { distributeRound } from "@/lib/bill-setup";
import {
  applyAction,
  applyRoll,
  applyScoring,
  createInitialState,
  DICE_PER_PLAYER,
  getValidActions,
  rollDice,
} from "@/lib/game-engine";

const LLM_ROLL_DELAY_MS = 500;
const LLM_BET_DELAY_MS = 500;

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

// 방의 플레이어 구성·게임 설정으로 1라운드 초기 GameState를 만든다.
// createInitialState()/distributeRound()는 싱글플레이와 동일한 게임 엔진 함수를 재사용한다.
function buildInitialGameState(payload: StartGamePayload): GameState | null {
  const playerConfigs: PlayerConfig[] = payload.playerConfig.map((p, i) => ({
    color: p.color,
    isLLM: p.isLLM,
    name: p.isLLM ? (p.modelId ?? `AI ${i + 1}`) : (p.name.trim() || `플레이어 ${i + 1}`),
    modelId: p.modelId ?? undefined,
  }));

  const state = createInitialState(playerConfigs);
  const activeColors = state.players.map((p) => p.color);
  const dist = distributeRound(state.billDeck, activeColors, payload.gameSettings.cutline);
  if (!dist) return null;

  state.casinos = dist.casinos;
  state.billDeck = dist.remainingDeck;
  state.round = 1;
  state.turn = 0;
  state.players = shufflePlayers(state.players, payload.gameSettings.humanFirst);
  state.currentPlayerIndex = 0;
  state.phase = "rolling";
  state.currentRoll = null;
  state.lastAction = null;

  return state;
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
  // 호스트가 나가면 방 전체를 닫고 남은 게스트에게 room-closed를 알린 뒤 방을 삭제한다.
  // 게스트가 나가면 해당 슬롯만 비우고 나머지 참가자에게 room-update를 브로드캐스트한다.
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

  // 모든 플레이어의 주사위가 소진되어 phase가 "scoring"이 된 직후 호출한다.
  // applyScoring()으로 정산을 반영하고, 다음 라운드 배치를 미리 계산해 캐싱해 둔다.
  // 배치에 실패하면(지폐 부족) 그대로 게임 종료 상태로 전환한다.
  function handleRoundCompletion(roomId: string, room: Room) {
    if (!room.gameState) return;
    const scored = applyScoring(room.gameState);

    const activeColors = scored.players.map((p) => p.color);
    const dist = distributeRound(scored.billDeck, activeColors, room.settings.cutline);

    if (dist) {
      room.nextRoundPreview = { casinos: dist.casinos, billDeck: dist.remainingDeck };
      scored.phase = "round-end";
    } else {
      room.nextRoundPreview = null;
      scored.phase = "game-end";
    }

    room.gameState = scored;
    io.to(roomId).emit("game-state", scored);
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
    }, LLM_ROLL_DELAY_MS);
  }

  // 현재 턴 플레이어가 LLM/깡통이면 굴린 결과에 대해 서버가 스스로 베팅을 선택해 진행한다.
  // TODO: 지금은 깡통과 동일하게 유효한 액션 중 무작위로 고른다 — 실제 LLM API 연동은 추후 구현.
  function scheduleLLMAutoBetIfNeeded(roomId: string) {
    const room = rooms.get(roomId);
    if (!room?.gameState || room.gameState.phase !== "awaiting-action") return;
    if (!room.gameState.players[room.gameState.currentPlayerIndex].isLLM) return;

    setTimeout(() => {
      const latestRoom = rooms.get(roomId);
      if (!latestRoom?.gameState || latestRoom.gameState.phase !== "awaiting-action") return;
      const player = latestRoom.gameState.players[latestRoom.gameState.currentPlayerIndex];
      if (!player.isLLM) return;
      const roll = latestRoom.gameState.currentRoll;
      if (!roll) return;

      const validActions = getValidActions(roll);
      if (validActions.length === 0) return;
      const action = validActions[Math.floor(Math.random() * validActions.length)];

      const nextState = applyAction(latestRoom.gameState, action);
      latestRoom.gameState = nextState;
      if (nextState.phase === "scoring") {
        handleRoundCompletion(roomId, latestRoom);
      } else {
        io.to(roomId).emit("game-state", nextState);
        scheduleLLMAutoRollIfNeeded(roomId);
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

      if (nextState.phase === "scoring") {
        // 전원 주사위 소진 — 정산 + 다음 라운드 배치 시도까지 한 번에 처리한다.
        handleRoundCompletion(roomId, room);
        return;
      }

      io.to(roomId).emit("game-state", nextState);
      // applyAction()이 이미 다음 플레이어로 턴을 넘겼으므로(주사위 없는 플레이어는 자동 스킵),
      // 다음 차례가 LLM/깡통이면 서버가 이어서 자동으로 굴린다.
      scheduleLLMAutoRollIfNeeded(roomId);
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
    });

    // /multi 페이지는 로비에서 방에 join된 소켓을 그대로 재사용하지만, game-started/game-state
    // 브로드캐스트는 host의 start-game 처리 직후 즉시 나가므로 아직 마운트되지 않은 페이지는
    // 이를 놓칠 수 있다. 마운트 시 이 이벤트로 현재 방의 게임 상태를 명시적으로 다시 요청한다.
    socket.on("request-game-state", (callback: (res: RequestGameStateAck) => void) => {
      const roomId = socketRooms.get(socket.id);
      const room = roomId ? rooms.get(roomId) : undefined;
      if (!room) {
        callback({ gameState: null, myColor: null, isHost: false });
        return;
      }
      const participant = room.participants.find((p) => p.socketId === socket.id);
      const myColor = participant ? room.colors[participant.slotIndex] ?? null : null;
      callback({ gameState: room.gameState, myColor, isHost: participant?.isHost ?? false });
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
