"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { CasinoNumber, CasinoState, PlayerState } from "@/types/game";
import { createBillDeck, distributeRound } from "@/lib/bill-setup";
import { scoreRound } from "@/lib/scoring";
import { Casino } from "@/components/Casino";
import { Die } from "@/components/DiceRoll";
import { PlayerPanel } from "@/components/PlayerPanel";

// ── Animation timing constants ────────────────────────────────────────────
const ROLL_DURATION_MS    = 750;  // shuffle animation total length before result is shown
const ROLL_SHUFFLE_MS     = 50;   // interval between random value changes during shuffle
const DIE_FADE_MS         = 250;  // each die's fade-in duration
const DIE_STAGGER_MS      = 100;  // delay added per die index (sequential appearance)

const EMPTY_DICE = { red: 0, yellow: 0, green: 0, blue: 0 };

const EMPTY_CASINOS: Record<CasinoNumber, CasinoState> = {
  1: { bills: [], dice: { ...EMPTY_DICE } },
  2: { bills: [], dice: { ...EMPTY_DICE } },
  3: { bills: [], dice: { ...EMPTY_DICE } },
  4: { bills: [], dice: { ...EMPTY_DICE } },
  5: { bills: [], dice: { ...EMPTY_DICE } },
  6: { bills: [], dice: { ...EMPTY_DICE } },
};

const INITIAL_PLAYERS: PlayerState[] = [
  { color: "red",    isLLM: false, score: 0, diceRemaining: 8 },
  { color: "yellow", isLLM: false, score: 0, diceRemaining: 8 },
  { color: "green",  isLLM: false, score: 0, diceRemaining: 8 },
  { color: "blue",   isLLM: false, score: 0, diceRemaining: 8 },
];

const PLAYER_LABELS = ["플레이어 1", "플레이어 2", "플레이어 3", "플레이어 4"];

const CASINO_NUMBERS: CasinoNumber[] = [1, 2, 3, 4, 5, 6];

function generateRoll(count: number): number[] {
  return Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1)
    .sort((a, b) => a - b);
}

// ── Turn phase ───────────────────────────────────────────────────────────────
// "pre-roll"  : blank dice fade in, roll button appears, all casinos bright but not clickable
// "rolling"   : dice shuffle randomly every ROLL_SHUFFLE_MS, roll button hidden
// "post-roll" : final pips shown, roll button hidden, matching casinos bright + clickable
type TurnPhase = "pre-roll" | "rolling" | "post-roll";

type NextRound = { casinos: Record<CasinoNumber, CasinoState>; deck: number[] };

export default function GamePage() {
  const router = useRouter();

  const [casinos, setCasinos]               = useState<Record<CasinoNumber, CasinoState>>(EMPTY_CASINOS);
  const [players, setPlayers]               = useState<PlayerState[]>(INITIAL_PLAYERS);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(0);
  const [turnPhase, setTurnPhase]           = useState<TurnPhase>("pre-roll");
  const [roll, setRoll]                     = useState<number[]>([]);
  const [hoveredCasino, setHoveredCasino]   = useState<number | null>(null);
  const [hoveredDiceFace, setHoveredDiceFace] = useState<number | null>(null);
  const [roundEnded, setRoundEnded]         = useState(false);
  const [round, setRound]                   = useState(1);
  const [billDeck, setBillDeck]             = useState<number[]>([]);
  // null = 지폐 부족으로 다음 라운드 불가, non-null = 다음 라운드 준비 완료
  const [nextRound, setNextRound]           = useState<NextRound | null>(null);
  const [gameOver, setGameOver]             = useState(false);
  const [preRollKey, setPreRollKey]         = useState(0);
  const [rollButtonEnabled, setRollButtonEnabled] = useState(false);
  const rollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [rollingValues, setRollingValues]     = useState<number[]>([]);
  const rollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rollingTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [exitingCasino, setExitingCasino]     = useState<CasinoNumber | null>(null);
  const [isPlacingDice, setIsPlacingDice]     = useState(false);
  const placingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function triggerPreRoll(diceCount: number) {
    const buttonDelay = (diceCount - 1) * DIE_STAGGER_MS + DIE_FADE_MS;
    if (rollTimerRef.current) clearTimeout(rollTimerRef.current);
    setRollButtonEnabled(false);
    setPreRollKey((k) => k + 1);
    rollTimerRef.current = setTimeout(() => setRollButtonEnabled(true), buttonDelay + DIE_FADE_MS);
  }

  useEffect(() => {
    const result = distributeRound(createBillDeck(), ["red", "yellow", "green", "blue"]);
    if (result) {
      setCasinos(result.casinos);
      setBillDeck(result.remainingDeck);
    }
    triggerPreRoll(8);
    return () => {
      if (rollTimerRef.current) clearTimeout(rollTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (rollingIntervalRef.current) clearInterval(rollingIntervalRef.current);
      if (rollingTimeoutRef.current) clearTimeout(rollingTimeoutRef.current);
      if (placingTimerRef.current) clearTimeout(placingTimerRef.current);
    };
  }, []);

  const current = players[currentPlayerIndex];

  const rollCounts = roll.reduce<Record<number, number>>((acc, face) => {
    acc[face] = (acc[face] ?? 0) + 1;
    return acc;
  }, {});
  const rollFaces = new Set(Object.keys(rollCounts).map(Number));

  const blankDice = Array<number>(current.diceRemaining).fill(0);

  // Group consecutive same-face dice for visual spacing (post-roll only)
  const diceGroups = roll.reduce<number[][]>((groups, face) => {
    const last = groups[groups.length - 1];
    if (last && last[0] === face) { last.push(face); } else { groups.push([face]); }
    return groups;
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleRoll() {
    if (roundEnded || !rollButtonEnabled) return;
    const finalRoll = generateRoll(current.diceRemaining);
    setRoll(finalRoll);
    setTurnPhase("rolling");

    const count = current.diceRemaining;
    const randomFaces = () =>
      Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1);

    setRollingValues(randomFaces());
    rollingIntervalRef.current = setInterval(() => setRollingValues(randomFaces()), ROLL_SHUFFLE_MS);

    rollingTimeoutRef.current = setTimeout(() => {
      if (rollingIntervalRef.current) {
        clearInterval(rollingIntervalRef.current);
        rollingIntervalRef.current = null;
      }
      setRollingValues([]);
      setTurnPhase("post-roll");
    }, ROLL_DURATION_MS);
  }

  function handleCasinoSelect(n: CasinoNumber) {
    if (roundEnded || isPlacingDice) return;
    const count = rollCounts[n];
    console.log(`${n}번 카지노에 ${current.color} 주사위 ${count}개가 베팅되었음`);

    // Compute all next states synchronously before starting animation
    const nextCasinos: Record<CasinoNumber, CasinoState> = {
      ...casinos,
      [n]: {
        ...casinos[n],
        dice: {
          ...casinos[n].dice,
          [current.color]: casinos[n].dice[current.color] + count,
        },
      },
    };
    const nextPlayers = players.map((p, i) =>
      i === currentPlayerIndex
        ? { ...p, diceRemaining: p.diceRemaining - count }
        : p
    );

    // Start exit animation; defer all state transitions until it completes
    setExitingCasino(n);
    setIsPlacingDice(true);

    placingTimerRef.current = setTimeout(() => {
      setExitingCasino(null);
      setIsPlacingDice(false);

      // All players exhausted → score the round
      if (nextPlayers.every((p) => p.diceRemaining === 0)) {
        console.log("라운드 종료");

        const activeColors = players.map((p) => p.color);
        const result = scoreRound(nextCasinos, activeColors);

        const scoredPlayers = nextPlayers.map((p) => ({
          ...p,
          score: p.score + (result.totalPayouts[p.color] ?? 0),
        }));

        console.log("── 정산 결과 ──");
        for (const p of scoredPlayers) {
          console.log(`  ${p.color}: ${p.score.toLocaleString()}원`);
        }

        const updatedDeck = [...billDeck, ...result.returnedBills];
        const nextDist = distributeRound(updatedDeck, activeColors);

        setCasinos(nextCasinos);
        setPlayers(scoredPlayers);
        setBillDeck(updatedDeck);
        setNextRound(nextDist ? { casinos: nextDist.casinos, deck: nextDist.remainingDeck } : null);
        setRoundEnded(true);
        setRoll([]);
        setTurnPhase("pre-roll");
        return;
      }

      // Normal turn: advance to next player with dice remaining
      setCasinos(nextCasinos);
      setPlayers(nextPlayers);

      let next = (currentPlayerIndex + 1) % nextPlayers.length;
      while (nextPlayers[next].diceRemaining === 0) {
        next = (next + 1) % nextPlayers.length;
      }

      setCurrentPlayerIndex(next);
      setRoll([]);
      setTurnPhase("pre-roll");
      setHoveredCasino(null);
      setHoveredDiceFace(null);
      triggerPreRoll(nextPlayers[next].diceRemaining);
    }, DIE_FADE_MS);
  }

  function handleNextRound() {
    if (!nextRound) return;
    setCasinos(nextRound.casinos);
    setBillDeck(nextRound.deck);
    setPlayers((prev) => prev.map((p) => ({ ...p, diceRemaining: 8 })));
    setRound((r) => r + 1);
    setCurrentPlayerIndex(0);
    setRoundEnded(false);
    setNextRound(null);
    setRoll([]);
    setTurnPhase("pre-roll");
    triggerPreRoll(8);
  }

  function handleGameOver() {
    setGameOver(true);
  }

  function handleGoMain() {
    router.push("/");
  }

  function handleRestart() {
    if (rollingIntervalRef.current) { clearInterval(rollingIntervalRef.current); rollingIntervalRef.current = null; }
    if (rollingTimeoutRef.current)  { clearTimeout(rollingTimeoutRef.current);  rollingTimeoutRef.current  = null; }
    if (placingTimerRef.current)    { clearTimeout(placingTimerRef.current);    placingTimerRef.current    = null; }
    setExitingCasino(null);
    setIsPlacingDice(false);
    const dist = distributeRound(createBillDeck(), ["red", "yellow", "green", "blue"]);
    if (!dist) return;
    setCasinos(dist.casinos);
    setBillDeck(dist.remainingDeck);
    setPlayers(INITIAL_PLAYERS);
    setCurrentPlayerIndex(0);
    setRound(1);
    setRoll([]);
    setTurnPhase("pre-roll");
    setRoundEnded(false);
    setNextRound(null);
    setGameOver(false);
    triggerPreRoll(8);
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
    if (roundEnded) return false;
    return turnPhase === "pre-roll" || turnPhase === "rolling" || rollFaces.has(n);
  }

  function casinoSelectable(n: number): boolean {
    if (roundEnded || isPlacingDice) return false;
    return turnPhase === "post-roll" && rollFaces.has(n);
  }

  // Button fade-in starts exactly when the last die's fade-in ends
  const buttonAnimDelay = (current.diceRemaining - 1) * DIE_STAGGER_MS + DIE_FADE_MS;

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
            highlighted={hoveredDiceFace === n}
            onHover={handleCasinoHover}
            onSelect={() => handleCasinoSelect(n)}
          />
        ))}
      </section>

      {/* ── Middle: dice ────────────────────────────────────────────────── */}
      <section className="flex-1 flex flex-col justify-center gap-3">

        {/* Dice row / round-end buttons — centered */}
        <div className="flex flex-col items-center gap-3">
          {roundEnded ? (
            gameOver ? (
              /* TODO: 최종 정산 UI 추가 필요 */
              <div className="flex flex-col items-center gap-4">
                <span className="text-2xl font-bold text-white">게임 종료</span>
                <div className="flex gap-3">
                  <button
                    className="px-6 py-3 bg-gray-700 hover:bg-gray-600 active:bg-gray-800 rounded-xl font-bold text-sm transition-colors"
                    onClick={handleGoMain}
                  >
                    메인화면으로
                  </button>
                  <button
                    className="px-6 py-3 bg-blue-700 hover:bg-blue-600 active:bg-blue-800 rounded-xl font-bold text-sm transition-colors"
                    onClick={handleRestart}
                  >
                    다시하기
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-4">
                <span className="text-2xl font-bold text-yellow-400">라운드 종료</span>
                <div className="flex gap-3">
                  {nextRound && (
                    <button
                      className="px-6 py-3 bg-blue-700 hover:bg-blue-600 active:bg-blue-800 rounded-xl font-bold text-sm transition-colors"
                      onClick={handleNextRound}
                    >
                      다음 라운드
                    </button>
                  )}
                  <button
                    className="px-6 py-3 bg-gray-700 hover:bg-gray-600 active:bg-gray-800 rounded-xl font-bold text-sm transition-colors"
                    onClick={handleGameOver}
                  >
                    게임 종료
                  </button>
                </div>
              </div>
            )
          ) : (
            <>
              {/* Dice row — pre-roll: animated blank / rolling: shuffling / post-roll: grouped */}
              {turnPhase === "pre-roll" ? (
                <div className="flex items-center gap-2">
                  {blankDice.map((_, idx) => (
                    <Die
                      key={`die-${preRollKey}-${idx}`}
                      value={0}
                      playerColor={current.color}
                      fadeInDelay={idx * DIE_STAGGER_MS}
                      fadeDuration={DIE_FADE_MS}
                    />
                  ))}
                </div>
              ) : turnPhase === "rolling" ? (
                <div className="flex items-center gap-2">
                  {rollingValues.map((face, idx) => (
                    <Die key={idx} value={face} playerColor={current.color} />
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  {diceGroups.map((group, gi) => (
                    <div key={gi} className="flex items-center gap-2">
                      {group.map((face, i) => (
                        <Die
                          key={`${gi}-${i}`}
                          value={face}
                          playerColor={current.color}
                          highlighted={!isPlacingDice && face !== 0 && hoveredCasino === face}
                          onHover={isPlacingDice ? undefined : handleDiceHover}
                          exiting={exitingCasino === face}
                          fadeDuration={DIE_FADE_MS}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* Roll button — space always reserved; fades in at 1000 ms, hidden in post-roll */}
              <button
                key={`btn-${preRollKey}`}
                className={[
                  "px-6 py-3 bg-gray-600 hover:bg-gray-500 active:bg-gray-700",
                  "rounded-xl font-bold text-sm transition-colors",
                  turnPhase !== "pre-roll" ? "invisible" : "",
                ].join(" ")}
                style={
                  turnPhase === "pre-roll"
                    ? {
                        animation: `fade-in-die 250ms ease-out ${buttonAnimDelay}ms both`,
                        pointerEvents: rollButtonEnabled ? "auto" : "none",
                      }
                    : undefined
                }
                onClick={handleRoll}
              >
                굴리기
              </button>
            </>
          )}
        </div>
      </section>

      {/* ── Round info ──────────────────────────────────────────────────── */}
      <div className="flex justify-center">
        <span className="text-sm text-gray-400 select-none">
          {round}라운드 | 남은 지폐 {billDeck.length}장
        </span>
      </div>

      {/* ── Player panels ───────────────────────────────────────────────── */}
      <section className="flex gap-4 justify-center">
        {players.map((player, i) => {
          const isActive = i === currentPlayerIndex && !roundEnded;
          return (
            <div key={player.color} className="flex flex-col items-center gap-1">
              <p className={`text-xs text-yellow-400 animate-pulse ${isActive ? "" : "invisible"}`}>
                생각 중...
              </p>
              <PlayerPanel
                player={player}
                label={PLAYER_LABELS[i]}
                isActive={isActive}
              />
            </div>
          );
        })}
      </section>

    </main>
  );
}
