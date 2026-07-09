"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { CasinoNumber, Color, GameState } from "@/types/game";
import { getSocket } from "@/lib/socket-client";
import type { RequestGameStateAck } from "@/types/multiplayer";
import { CASINO_NUMBERS } from "@/lib/bill-setup";
import { Casino } from "@/components/Casino";
import { Die } from "@/components/DiceRoll";
import { PlayerPanel } from "@/components/PlayerPanel";

export default function MultiplayerGamePage() {
  const router = useRouter();

  // 로비에서 방을 만들거나 참가할 때 이미 연결되어 있는 공유 소켓을 그대로 재사용한다.
  // 이 소켓만 서버의 해당 방(room)에 join되어 있으므로, 새 연결을 만들면 브로드캐스트를 받을 수 없다.
  const [connected, setConnected] = useState(() => getSocket().connected);
  const [gameState, setGameState] = useState<GameState | null>(null);
  // 이 소켓이 조작 가능한 플레이어 색상. 게임 시작 시 한 번 정해지면 이후 바뀌지 않는다.
  const [myColor, setMyColor] = useState<Color | null>(null);
  const [isHost, setIsHost] = useState(false);

  useEffect(() => {
    const socket = getSocket();

    function handleConnect() { setConnected(true); }
    function handleDisconnect() { setConnected(false); }
    function handleGameState(state: GameState) { setGameState(state); }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("game-state", handleGameState);

    // game-started/game-state 브로드캐스트는 호스트가 게임을 시작하는 즉시 나가므로, 이 페이지가
    // 아직 마운트되기 전(이동 중)이라 놓쳤을 수 있다. 마운트 시 현재 상태를 다시 요청해 보정한다.
    socket.emit("request-game-state", (res: RequestGameStateAck) => {
      if (res.gameState) setGameState(res.gameState);
      setMyColor(res.myColor);
      setIsHost(res.isHost);
    });

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("game-state", handleGameState);
    };
  }, []);

  function handleRollDice() {
    getSocket().emit("roll-dice");
  }

  function handlePlaceBet(casino: CasinoNumber) {
    getSocket().emit("place-bet", { casino });
  }

  function handleNextRound() {
    if (!isHost) return;
    getSocket().emit("next-round");
  }

  // 서버에서 게임 상태를 수신하기 전까지는 대기 화면만 렌더링한다.
  if (!gameState) {
    return (
      <main className="h-screen bg-zinc-950 text-white flex items-center justify-center">
        <span className="text-sm text-gray-400">
          {connected ? "게임 상태를 기다리는 중입니다..." : "서버에 연결하는 중입니다..."}
        </span>
      </main>
    );
  }

  const { casinos, players, round, billDeck, currentPlayerIndex, phase, currentRoll } = gameState;

  // ── 라운드 종료: 정산 결과(소지금) 표시 + 다음 라운드(호스트 전용)/게임 종료 버튼 ──
  if (phase === "round-end") {
    return (
      <main className="h-screen bg-zinc-950 text-white flex flex-col items-center justify-center gap-6">
        <span className="text-2xl font-bold text-yellow-400">라운드 종료</span>
        <section className="flex gap-4 justify-center">
          {players.map((player, i) => (
            <PlayerPanel
              key={player.color}
              player={player}
              label={player.name ?? `플레이어 ${i + 1}`}
              isActive={false}
            />
          ))}
        </section>
        <div className="flex gap-3">
          <button
            className={[
              "px-6 py-3 bg-blue-700 rounded-xl font-bold text-sm transition-colors",
              isHost ? "hover:bg-blue-600 active:bg-blue-800" : "opacity-40 cursor-not-allowed",
            ].join(" ")}
            disabled={!isHost}
            onClick={handleNextRound}
          >
            다음 라운드
          </button>
          <button
            className="px-6 py-3 bg-gray-700 hover:bg-gray-600 active:bg-gray-800 rounded-xl font-bold text-sm transition-colors"
            onClick={() => router.push("/")}
          >
            게임 종료
          </button>
        </div>
      </main>
    );
  }

  // ── 게임 종료: 최종 소지금과 우승자 표시 ──
  if (phase === "game-end") {
    const maxScore = Math.max(...players.map((p) => p.score));
    const winnerNames = players
      .filter((p) => p.score === maxScore)
      .map((p) => p.name ?? p.color)
      .join(", ");

    return (
      <main className="h-screen bg-zinc-950 text-white flex flex-col items-center justify-center gap-6">
        <div className="flex flex-col items-center gap-4">
          <span className="text-base font-bold text-yellow-300">
            최종 소지금 {maxScore.toLocaleString()}으로 {winnerNames} 우승!
          </span>
          <span className="text-2xl font-bold text-white">게임 종료</span>
        </div>
        <section className="flex gap-4 justify-center">
          {players.map((player, i) => (
            <PlayerPanel
              key={player.color}
              player={player}
              label={player.name ?? `플레이어 ${i + 1}`}
              isActive={false}
            />
          ))}
        </section>
      </main>
    );
  }

  const current = players[currentPlayerIndex];
  const isMyTurn = myColor !== null && current.color === myColor;
  const rollFaces = new Set(currentRoll ?? []);

  // pre-roll: 전부 밝게(아직 선택 불가) / awaiting-action: 굴린 눈에 해당하는 카지노만 밝게 + 내 턴일 때만 클릭 가능
  function casinoCanPlace(n: CasinoNumber): boolean {
    return phase === "rolling" || rollFaces.has(n);
  }

  function casinoSelectable(n: CasinoNumber): boolean {
    return isMyTurn && phase === "awaiting-action" && rollFaces.has(n);
  }

  // TODO: 정산 연출 애니메이션은 추후 구현. 지금은 굴리기·베팅·라운드 전환까지만 상호작용한다.
  return (
    <main className="h-screen bg-zinc-950 text-white flex flex-col p-4 gap-5 overflow-hidden">
      {/* ── Casinos ─────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-6 gap-3">
        {CASINO_NUMBERS.map((n) => (
          <Casino
            key={n}
            number={n}
            state={casinos[n]}
            canPlace={casinoCanPlace(n)}
            selectable={casinoSelectable(n)}
            highlighted={false}
            onHover={() => {}}
            onSelect={() => handlePlaceBet(n)}
          />
        ))}
      </section>

      {/* ── Middle: dice ────────────────────────────────────────────────── */}
      <section className="flex-1 flex flex-col justify-center items-center gap-3">
        {phase === "rolling" ? (
          <>
            <div className="flex items-center gap-2">
              {Array.from({ length: current.diceRemaining }, (_, idx) => (
                <Die key={idx} value={0} playerColor={current.color} />
              ))}
            </div>
            <button
              className={[
                "px-6 py-3 bg-gray-600 hover:bg-gray-500 active:bg-gray-700",
                "rounded-xl font-bold text-sm transition-colors",
                isMyTurn ? "" : "invisible pointer-events-none",
              ].join(" ")}
              onClick={handleRollDice}
            >
              굴리기
            </button>
          </>
        ) : (
          <div className="flex items-center gap-2">
            {(currentRoll ?? []).map((face, idx) => (
              <Die key={idx} value={face} playerColor={current.color} />
            ))}
          </div>
        )}
      </section>

      {/* ── Round info ──────────────────────────────────────────────────── */}
      <div className="flex justify-center">
        <span className="text-sm text-gray-400 select-none">
          {round}라운드 | 남은 지폐 {billDeck.length}장
        </span>
      </div>

      {/* ── Player panels ───────────────────────────────────────────────── */}
      <section className="flex gap-4 justify-center">
        {players.map((player, i) => (
          <PlayerPanel
            key={player.color}
            player={player}
            label={player.name ?? `플레이어 ${i + 1}`}
            isActive={i === currentPlayerIndex}
          />
        ))}
      </section>
    </main>
  );
}
