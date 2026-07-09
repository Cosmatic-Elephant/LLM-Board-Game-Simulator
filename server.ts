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
  type RoomParticipant,
  type UpdateColorPayload,
  type UpdateModelPayload,
  type UpdateSettingsPayload,
} from "@/types/multiplayer";

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

  io.on("connection", (socket) => {
    console.log(`[Socket] 클라이언트 연결됨: ${socket.id}`);

    socket.on("create-room", (payload: CreateRoomPayload, callback: (res: CreateRoomAck) => void) => {
      const roomId = generateRoomId(rooms);
      const room: Room = {
        participants: [{ socketId: socket.id, slotIndex: 0, name: payload.name, isHost: true }],
        colors: [...DEFAULT_SLOT_COLORS],
        models: Array(MAX_ROOM_PLAYERS).fill(DEFAULT_SLOT_MODEL_ID),
        settings: { humanFirst: DEFAULT_HUMAN_FIRST, cutline: DEFAULT_CUTOFF },
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
