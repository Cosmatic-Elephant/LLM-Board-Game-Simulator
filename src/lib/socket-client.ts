import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;

// 로비 팝업이 열리고 닫힐 때마다 새로 연결하지 않도록 모듈 스코프에 싱글턴으로 보관한다.
export function getSocket(): Socket {
  if (!socket) {
    socket = io();
  }
  return socket;
}
