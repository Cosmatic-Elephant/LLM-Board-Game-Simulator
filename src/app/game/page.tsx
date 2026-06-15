"use client";

import { useState } from "react";
import type { GameState, CasinoNumber, CasinoState } from "@/types/game";
import { Casino } from "@/components/Casino";
import { Die } from "@/components/DiceRoll";
import { PlayerPanel } from "@/components/PlayerPanel";

// ── Mock game data (static — only player turn / dice are live) ──────────────
const MOCK: GameState = {
  phase: "awaiting-action",
  round: 3,
  turn: 5,
  currentPlayerIndex: 0,
  players: [
    { color: "red",    isLLM: false, score: 120000, diceRemaining: 8 },
    { color: "yellow", isLLM: false, score: 80000,  diceRemaining: 8 },
    { color: "green",  isLLM: false, score: 160000, diceRemaining: 8 },
    { color: "blue",   isLLM: false, score: 95000,  diceRemaining: 8 },
  ],
  casinos: {
    1: { bills: [40000, 20000], dice: { red: 2, yellow: 0, green: 1, blue: 0 } },
    2: { bills: [90000],        dice: { red: 0, yellow: 0, green: 2, blue: 1 } },
    3: { bills: [30000, 20000, 10000], dice: { red: 1, yellow: 0, green: 0, blue: 2 } },
    4: { bills: [80000],        dice: { red: 0, yellow: 3, green: 0, blue: 0 } },
    5: { bills: [40000, 30000], dice: { red: 0, yellow: 0, green: 3, blue: 2 } },
    6: { bills: [70000],        dice: { red: 2, yellow: 0, green: 0, blue: 0 } },
  } as Record<CasinoNumber, CasinoState>,
  billDeck: [],
  currentRoll: null,
  lastAction: null,
};

const PLAYER_LABELS = ["플레이어 1", "플레이어 2", "플레이어 3", "플레이어 4"];

const CASINO_NUMBERS: CasinoNumber[] = [1, 2, 3, 4, 5, 6];

const BLANK_DICE = Array<number>(8).fill(0);

function generateRoll(): number[] {
  return Array.from({ length: 8 }, () => Math.floor(Math.random() * 6) + 1)
    .sort((a, b) => a - b);
}

// ── Turn phase ───────────────────────────────────────────────────────────────
// "pre-roll"  : blank dice shown, roll button visible, all casinos bright but not clickable
// "post-roll" : pips shown, roll button hidden, matching casinos bright + clickable
type TurnPhase = "pre-roll" | "post-roll";

export default function GamePage() {
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(0);
  const [turnPhase, setTurnPhase]                   = useState<TurnPhase>("pre-roll");
  const [roll, setRoll]                             = useState<number[]>([]);
  const [hoveredCasino, setHoveredCasino]           = useState<number | null>(null);
  const [hoveredDiceFace, setHoveredDiceFace]       = useState<number | null>(null);

  const state   = MOCK;
  const current = state.players[currentPlayerIndex];

  const rollCounts = roll.reduce<Record<number, number>>((acc, face) => {
    acc[face] = (acc[face] ?? 0) + 1;
    return acc;
  }, {});
  const rollFaces = new Set(Object.keys(rollCounts).map(Number));

  const diceToRender = turnPhase === "pre-roll" ? BLANK_DICE : roll;

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleRoll() {
    setRoll(generateRoll());
    setTurnPhase("post-roll");
  }

  function handleCasinoSelect(n: CasinoNumber) {
    console.log(`${n}번 카지노에 ${current.color} 주사위 ${rollCounts[n]}개가 베팅되었음`);

    // advance to next player and reset turn
    setCurrentPlayerIndex((prev) => (prev + 1) % state.players.length);
    setRoll([]);
    setTurnPhase("pre-roll");
    setHoveredCasino(null);
    setHoveredDiceFace(null);
  }

  function handleCasinoHover(n: number | null) {
    setHoveredCasino(n);
    setHoveredDiceFace(null);
  }

  function handleDiceHover(face: number | null) {
    setHoveredDiceFace(face);
    setHoveredCasino(null);
  }

  // ── Casino visibility per phase ───────────────────────────────────────────
  // pre-roll  : all bright, none clickable
  // post-roll : only matching faces bright + clickable; others dark
  function casinoCanPlace(n: number): boolean {
    return turnPhase === "pre-roll" || rollFaces.has(n);
  }

  function casinoSelectable(n: number): boolean {
    return turnPhase === "post-roll" && rollFaces.has(n);
  }

  return (
    <main className="h-screen bg-zinc-950 text-white flex flex-col p-4 gap-5 overflow-hidden">

      {/* ── Casinos ─────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-6 gap-3">
        {CASINO_NUMBERS.map((n) => (
          <Casino
            key={n}
            number={n}
            state={state.casinos[n]}
            canPlace={casinoCanPlace(n)}
            selectable={casinoSelectable(n)}
            highlighted={hoveredDiceFace === n}
            onHover={handleCasinoHover}
            onSelect={() => handleCasinoSelect(n)}
          />
        ))}
      </section>

      {/* ── Middle: dice + round ────────────────────────────────────────── */}
      <section className="flex-1 flex flex-col justify-center gap-3 relative">

        {/* Round counter — pinned to the right */}
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-2xl font-bold text-gray-300 select-none">
          라운드: {state.round}
        </span>

        {/* Dice row + roll button — centered */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            {diceToRender.map((face, i) => (
              <Die
                key={i}
                value={face}
                playerColor={current.color}
                highlighted={face !== 0 && hoveredCasino === face}
                onHover={turnPhase === "post-roll" ? handleDiceHover : undefined}
              />
            ))}

            {turnPhase === "pre-roll" && (
              <button
                className="ml-3 px-6 py-3 bg-gray-600 hover:bg-gray-500 active:bg-gray-700
                           rounded-xl font-bold text-sm transition-colors"
                onClick={handleRoll}
              >
                굴리기
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Player panels ───────────────────────────────────────────────── */}
      <section className="flex gap-4 justify-center">
        {state.players.map((player, i) => (
          <PlayerPanel
            key={player.color}
            player={player}
            label={PLAYER_LABELS[i]}
            isActive={i === currentPlayerIndex}
            isThinking={false}
          />
        ))}
      </section>

    </main>
  );
}
