"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import type { Action, Color, CasinoNumber, CasinoState, LLMGameState, PlayerState, ScoringStep } from "@/types/game";
import { createBillDeck, distributeRound } from "@/lib/bill-setup";
import { computeScoringSteps } from "@/lib/scoring";
import { isValidAction } from "@/lib/game-engine";
import { Casino } from "@/components/Casino";
import { Die } from "@/components/DiceRoll";
import { PlayerPanel } from "@/components/PlayerPanel";

// ── Animation timing constants ────────────────────────────────────────────
const ROLL_DURATION_MS    = 750;  // shuffle animation total length before result is shown
const ROLL_SHUFFLE_MS     = 50;   // interval between random value changes during shuffle
const DIE_FADE_MS         = 250;  // each die's fade-in duration
const DIE_STAGGER_MS      = 100;  // delay added per die index (sequential appearance)
const SCORING_FADE_MS     = 400;  // base duration for every scoring animation step
const LLM_ROLL_DELAY_MS   = 500;  // delay before LLM auto-roll
const LLM_PLACE_DELAY_MS  = 500;  // delay before LLM API call (post-roll)

const PLAYER_CONFIG_KEY   = "las-vegas:playerConfig";
const GAME_SETTINGS_KEY   = "las-vegas:gameSettings";
const DEFAULT_SETTINGS    = { humanFirst: true, cutline: 50000 };

const EMPTY_DICE: Record<Color, number> = { red: 0, yellow: 0, green: 0, blue: 0, orange: 0, purple: 0, pink: 0, white: 0 };

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

// ── Scoring animation state ──────────────────────────────────────────────────

interface ScoringAnimState {
  casinoIdx: number;             // 0–5, index into CASINO_NUMBERS
  fadingColors: Color[];         // currently animating out (tie elimination)
  winnerColor: Color | null;     // current rank winner: dice row highlighted
  highlightedBillIdx: number | null;
  exitingBillIdx: number | null;
  // Cross-casino persistent maps — never reset when moving to the next casino
  eliminatedColorsByCasino: Partial<Record<number, Color[]>>;
  exitedBillsByCasino: Partial<Record<number, number[]>>;
  // Final table-clear phase: fade out all remaining dice/bills simultaneously
  tableClearing: boolean;
}

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
  const [turn, setTurn]                     = useState(0);
  const [billDeck, setBillDeck]             = useState<number[]>([]);
  // null = 지폐 부족으로 다음 라운드 불가, non-null = 다음 라운드 준비 완료
  const [nextRound, setNextRound]           = useState<NextRound | null>(null);
  const [gameOver, setGameOver]             = useState(false);
  const [preRollKey, setPreRollKey]         = useState(0);
  const [rollingValues, setRollingValues]     = useState<number[]>([]);
  const rollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const rollingTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [exitingCasino, setExitingCasino]     = useState<CasinoNumber | null>(null);
  const [isPlacingDice, setIsPlacingDice]     = useState(false);
  const placingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scoringAnim, setScoringAnim]         = useState<ScoringAnimState | null>(null);
  const scoringTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [displayScores, setDisplayScores]     = useState<Record<Color, number>>({ ...EMPTY_DICE });
  const finalScoresRef = useRef<Record<Color, number>>({ ...EMPTY_DICE });
  const initialPlayersRef = useRef<PlayerState[]>(INITIAL_PLAYERS);
  const llmIsRunningRef   = useRef(false);
  const humanFirstRef     = useRef(DEFAULT_SETTINGS.humanFirst);
  const cutlineRef        = useRef(DEFAULT_SETTINGS.cutline);
  const [scoreDeltaPopups, setScoreDeltaPopups] = useState<Partial<Record<Color, { amount: number; key: number }>>>({});
  const [showExitConfirm, setShowExitConfirm]   = useState(false);

  function triggerPreRoll() {
    setPreRollKey((k) => k + 1);
  }

  useEffect(() => {
    const rawPlayers = localStorage.getItem(PLAYER_CONFIG_KEY);
    const playerConfigs = rawPlayers
      ? (JSON.parse(rawPlayers) as Array<{ color: Color; isLLM: boolean; modelId: string | null }>)
      : null;
    const initialPlayers: PlayerState[] = playerConfigs
      ? playerConfigs.map((c) => ({
          color: c.color,
          isLLM: c.isLLM,
          modelId: c.modelId ?? undefined,
          score: 0,
          diceRemaining: 8,
        }))
      : INITIAL_PLAYERS;

    const rawSettings = localStorage.getItem(GAME_SETTINGS_KEY);
    const settings = rawSettings
      ? (JSON.parse(rawSettings) as { humanFirst: boolean; cutline: number })
      : DEFAULT_SETTINGS;

    humanFirstRef.current = settings.humanFirst;
    cutlineRef.current    = settings.cutline;

    initialPlayersRef.current = initialPlayers;
    setPlayers(shufflePlayers(initialPlayers, settings.humanFirst));

    const activeColors = initialPlayers.map((p) => p.color);
    const result = distributeRound(createBillDeck(), activeColors, settings.cutline);
    if (result) {
      setCasinos(result.casinos);
      setBillDeck(result.remainingDeck);
    }
    triggerPreRoll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (rollingIntervalRef.current) clearInterval(rollingIntervalRef.current);
      if (rollingTimeoutRef.current) clearTimeout(rollingTimeoutRef.current);
      if (placingTimerRef.current) clearTimeout(placingTimerRef.current);
      for (const t of scoringTimersRef.current) clearTimeout(t);
    };
  }, []);

  // ── LLM auto-play ──────────────────────────────────────────────────────────
  // Triggers on every turn change. Handles both phases in sequence:
  //   pre-roll  → wait LLM_ROLL_DELAY_MS, then auto-roll
  //   post-roll → wait LLM_PLACE_DELAY_MS, call /api/llm-action, then bet
  // llmIsRunningRef bridges the two phases so only one flow runs at a time.
  useEffect(() => {
    const currentPlayer = players[currentPlayerIndex];
    if (!currentPlayer?.isLLM) return;
    if (roundEnded || scoringAnim !== null) return;

    // ── Phase 1: pre-roll ───────────────────────────────────────────────────
    if (turnPhase === "pre-roll") {
      if (llmIsRunningRef.current) return;
      llmIsRunningRef.current = true;

      const timer = setTimeout(handleRoll, LLM_ROLL_DELAY_MS);
      // cleanup only cancels the timer; flag stays true so post-roll proceeds
      return () => clearTimeout(timer);
    }

    // ── Phase 2: post-roll ──────────────────────────────────────────────────
    if (turnPhase === "post-roll" && llmIsRunningRef.current) {
      let cancelled = false;

      const timer = setTimeout(async () => {
        const validFaceEntries = Object.entries(rollCounts).map(([face, count]) => ({
          face: Number(face) as CasinoNumber,
          count,
        }));

        if (validFaceEntries.length === 0) {
          llmIsRunningRef.current = false;
          return;
        }

        const fallbackCasino = validFaceEntries[0].face;

        const payload: LLMGameState = {
          game: { round, turn },
          casinos: Object.fromEntries(
            CASINO_NUMBERS.map((n) => [
              String(n),
              { bills: casinos[n].bills, dice: casinos[n].dice },
            ])
          ),
          players: Object.fromEntries(
            players.map((p) => [
              p.color,
              { is_llm: p.isLLM, score: p.score, dice_remaining: p.diceRemaining },
            ])
          ) as LLMGameState["players"],
          my_color: currentPlayer.color,
          my_roll: Object.fromEntries(
            validFaceEntries.map(({ face, count }) => [String(face), count])
          ),
          valid_actions: validFaceEntries.map(({ face, count }) => ({
            casino: face,
            dice_count: count,
          })),
        };

        try {
          const res = await fetch("/api/llm-action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ modelId: currentPlayer.modelId, payload }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          const data = await res.json() as {
            action: { casino: number; dice_count: number };
            reasoning?: string;
          };
          const action: Action = {
            casino: data.action.casino as CasinoNumber,
            diceCount: data.action.dice_count,
          };

          if (!isValidAction(action, roll)) {
            throw new Error("LLM returned an action outside valid_actions");
          }

          if (!cancelled) handleCasinoSelect(action.casino);
        } catch (err) {
          console.error("[LLM] action failed, using fallback:", err);
          if (!cancelled) handleCasinoSelect(fallbackCasino);
        } finally {
          llmIsRunningRef.current = false;
        }
      }, LLM_PLACE_DELAY_MS);

      return () => {
        cancelled = true;
        clearTimeout(timer);
        llmIsRunningRef.current = false;
      };
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, currentPlayerIndex, turnPhase]);

  // TEST ONLY — delete before release
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "q" || e.key === "Q") qHandlerRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ── Scoring animation driver ─────────────────────────────────────────────

  function runScoringAnimation(
    steps: ScoringStep[],
    capturedBillDeck: number[],
    activeColors: Color[]
  ) {
    for (const t of scoringTimersRef.current) clearTimeout(t);
    scoringTimersRef.current = [];
    setScoreDeltaPopups({});

    const casinoSteps = steps.filter(
      (s): s is Extract<ScoringStep, { kind: "casino-reveal" }> =>
        s.kind === "casino-reveal"
    );
    const scoreStep = steps[steps.length - 1] as Extract<
      ScoringStep,
      { kind: "score-update" }
    >;

    // ── Apply all actual state changes immediately ──────────────────────────
    // Scores are final from the start so skip always shows correct values
    setPlayers((prev) =>
      prev.map((p) => ({
        ...p,
        score: p.score + (scoreStep.deltaByColor[p.color] ?? 0),
      }))
    );
    const finalDeck = [...capturedBillDeck, ...scoreStep.returnedBills];
    setBillDeck(finalDeck);
    const nextDist = distributeRound(finalDeck, activeColors, cutlineRef.current);
    setNextRound(nextDist ? { casinos: nextDist.casinos, deck: nextDist.remainingDeck } : null);

    // ── Initialize display scores from pre-update values ────────────────────
    const preScores = Object.fromEntries(
      players.map((p) => [p.color, p.score])
    ) as Record<Color, number>;
    setDisplayScores(preScores);
    finalScoresRef.current = Object.fromEntries(
      players.map((p) => [p.color, p.score + (scoreStep.deltaByColor[p.color] ?? 0)])
    ) as Record<Color, number>;

    // ── Schedule animation timers ───────────────────────────────────────────
    function schedule(fn: () => void, d: number) {
      const t = setTimeout(fn, d);
      scoringTimersRef.current.push(t);
    }

    let delay = 0;

    for (let ci = 0; ci < casinoSteps.length; ci++) {
      const step = casinoSteps[ci];
      const casinoIdx = ci;

      // Activate casino highlight — preserve cross-casino history maps
      schedule(() => {
        setScoringAnim((prev) => ({
          casinoIdx,
          fadingColors: [],
          winnerColor: null,
          highlightedBillIdx: null,
          exitingBillIdx: null,
          eliminatedColorsByCasino: prev?.eliminatedColorsByCasino ?? {},
          exitedBillsByCasino: prev?.exitedBillsByCasino ?? {},
          tableClearing: false,
        }));
      }, delay);
      delay += 150;

      for (const event of step.events) {
        if (event.kind === "tie-eliminated") {
          const ev = event;
          schedule(() => {
            setScoringAnim((prev) =>
              prev ? { ...prev, fadingColors: ev.colors } : prev
            );
          }, delay);
          delay += SCORING_FADE_MS;
          // Animation done — persist in cross-casino map
          schedule(() => {
            setScoringAnim((prev) => {
              if (!prev) return prev;
              const existing = prev.eliminatedColorsByCasino[prev.casinoIdx] ?? [];
              return {
                ...prev,
                fadingColors: [],
                eliminatedColorsByCasino: {
                  ...prev.eliminatedColorsByCasino,
                  [prev.casinoIdx]: [...existing, ...ev.colors],
                },
              };
            });
          }, delay);
          delay += 100;
        } else {
          const ev = event;
          // Step 1: highlight winner dice + bill
          schedule(() => {
            setScoringAnim((prev) =>
              prev
                ? { ...prev, winnerColor: ev.color, highlightedBillIdx: ev.billIndex, exitingBillIdx: null }
                : prev
            );
          }, delay);
          delay += SCORING_FADE_MS;
          // Step 2: bill fades out + displayScore increases + delta popup simultaneously
          schedule(() => {
            setScoringAnim((prev) =>
              prev ? { ...prev, winnerColor: null, exitingBillIdx: ev.billIndex } : prev
            );
            setDisplayScores((prev) => ({
              ...prev,
              [ev.color]: (prev[ev.color] ?? 0) + ev.amount,
            }));
            setScoreDeltaPopups((prev) => ({
              ...prev,
              [ev.color]: { amount: ev.amount, key: (prev[ev.color]?.key ?? 0) + 1 },
            }));
          }, delay);
          delay += SCORING_FADE_MS;
          // Step 3: persist exited bill in cross-casino map
          schedule(() => {
            setScoringAnim((prev) => {
              if (!prev) return prev;
              const existing = prev.exitedBillsByCasino[prev.casinoIdx] ?? [];
              return {
                ...prev,
                highlightedBillIdx: null,
                exitingBillIdx: null,
                exitedBillsByCasino: {
                  ...prev.exitedBillsByCasino,
                  [prev.casinoIdx]: [...existing, ev.billIndex],
                },
              };
            });
          }, delay);
          delay += 100;
        }
      }

      delay += Math.round(SCORING_FADE_MS * 0.5);
    }

    // All casinos done — trigger table-clear
    schedule(() => {
      setScoringAnim((prev) => prev ? { ...prev, tableClearing: true } : prev);
    }, delay);
    delay += SCORING_FADE_MS;

    // Table clear complete — wipe casinos and reveal UI in one React batch
    schedule(() => {
      setScoringAnim(null);
      setCasinos(EMPTY_CASINOS);
      setScoreDeltaPopups({});
      setRoundEnded(true);
    }, delay);
  }

  function handleSkipScoring() {
    for (const t of scoringTimersRef.current) clearTimeout(t);
    scoringTimersRef.current = [];
    setScoringAnim(null);
    setCasinos(EMPTY_CASINOS);
    setDisplayScores(finalScoresRef.current);
    setScoreDeltaPopups({});
    setRoundEnded(true);
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleRoll() {
    if (roundEnded) return;
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

      // All players exhausted → start scoring animation
      if (nextPlayers.every((p) => p.diceRemaining === 0)) {
        const activeColors = players.map((p) => p.color);
        const scoringSteps = computeScoringSteps(nextCasinos, activeColors);
        setCasinos(nextCasinos);
        setPlayers(nextPlayers);
        setRoll([]);
        setTurnPhase("pre-roll");
        setTurn((t) => t + 1);
        runScoringAnimation(scoringSteps, billDeck, activeColors);
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
      setTurn((t) => t + 1);
      triggerPreRoll();
    }, DIE_FADE_MS);
  }

  function handleNextRound() {
    if (!nextRound) return;
    const shuffled = shufflePlayers(players.map((p) => ({ ...p, diceRemaining: 8 })), humanFirstRef.current);
    setCasinos(nextRound.casinos);
    setBillDeck(nextRound.deck);
    setPlayers(shuffled);
    setRound((r) => r + 1);
    setTurn(0);
    setCurrentPlayerIndex(0);
    setRoundEnded(false);
    setNextRound(null);
    setRoll([]);
    setTurnPhase("pre-roll");
    llmIsRunningRef.current = false;
    triggerPreRoll();
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
    for (const t of scoringTimersRef.current) clearTimeout(t);
    scoringTimersRef.current = [];
    setScoringAnim(null);
    setScoreDeltaPopups({});
    setExitingCasino(null);
    setIsPlacingDice(false);
    llmIsRunningRef.current = false;
    const restorePlayers = initialPlayersRef.current.map((p) => ({ ...p, score: 0, diceRemaining: 8 }));
    const shuffled = shufflePlayers(restorePlayers, humanFirstRef.current);
    const activeColors = shuffled.map((p) => p.color);
    const dist = distributeRound(createBillDeck(), activeColors, cutlineRef.current);
    if (!dist) return;
    setCasinos(dist.casinos);
    setBillDeck(dist.remainingDeck);
    setPlayers(shuffled);
    setCurrentPlayerIndex(0);
    setRound(1);
    setTurn(0);
    setRoll([]);
    setTurnPhase("pre-roll");
    setRoundEnded(false);
    setNextRound(null);
    setGameOver(false);
    triggerPreRoll();
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
  // scoring   : all bright (dice/bills visible for animation), none clickable
  function casinoCanPlace(n: number): boolean {
    if (roundEnded) return false;
    if (scoringAnim !== null) return true;
    return turnPhase === "pre-roll" || turnPhase === "rolling" || rollFaces.has(n);
  }

  function casinoSelectable(n: number): boolean {
    if (roundEnded || isPlacingDice || scoringAnim !== null) return false;
    if (current.isLLM) return false;
    return turnPhase === "post-roll" && rollFaces.has(n);
  }

  // Button fade-in starts exactly when the last die's fade-in ends
  // TEST ONLY — delete before release
  const qHandlerRef = useRef<() => void>(() => {});
  qHandlerRef.current = () => {
    if (roundEnded || scoringAnim !== null) return;
    if (turnPhase === "pre-roll") {
      handleRoll();
    } else if (turnPhase === "post-roll" && !isPlacingDice) {
      const candidates = CASINO_NUMBERS.filter((n) => rollFaces.has(n));
      if (!candidates.length) return;
      handleCasinoSelect(candidates[Math.floor(Math.random() * candidates.length)]);
    }
  };

  return (
    <main className="h-screen bg-zinc-950 text-white flex flex-col p-4 gap-5 overflow-hidden">

      {/* ── Casinos ─────────────────────────────────────────────────────── */}
      <section className="grid grid-cols-6 gap-3">
        {CASINO_NUMBERS.map((n, idx) => {
          const isCurrentCasino =
            scoringAnim !== null &&
            scoringAnim.casinoIdx === idx &&
            !scoringAnim.tableClearing;
          return (
            <Casino
              key={n}
              number={n}
              state={casinos[n]}
              canPlace={casinoCanPlace(n)}
              selectable={casinoSelectable(n)}
              highlighted={hoveredDiceFace === n || isCurrentCasino}
              scoringFadingColors={isCurrentCasino ? scoringAnim!.fadingColors : undefined}
              scoringEliminatedColors={scoringAnim?.eliminatedColorsByCasino[idx]}
              scoringHighlightedColor={isCurrentCasino ? scoringAnim!.winnerColor : undefined}
              scoringHighlightedBillIdx={isCurrentCasino ? scoringAnim!.highlightedBillIdx : undefined}
              scoringExitingBillIdx={isCurrentCasino ? scoringAnim!.exitingBillIdx : undefined}
              scoringExitedBillIndices={scoringAnim?.exitedBillsByCasino[idx]}
              scoringTableClearing={scoringAnim?.tableClearing}
              fadeDuration={SCORING_FADE_MS}
              onHover={handleCasinoHover}
              onSelect={() => handleCasinoSelect(n)}
            />
          );
        })}
      </section>

      {/* ── Middle: dice ────────────────────────────────────────────────── */}
      <section className="flex-1 flex flex-col justify-center gap-3">

        {/* Dice row / round-end buttons — centered */}
        <div className="flex flex-col items-center gap-3">
          {scoringAnim !== null && !roundEnded ? (
            <button
              className="px-5 py-2.5 bg-gray-700/60 hover:bg-gray-600/60 active:bg-gray-800/60 rounded-xl text-sm font-bold text-gray-400 hover:text-gray-200 transition-colors"
              onClick={handleSkipScoring}
            >
              스킵
            </button>
          ) : roundEnded ? (
            gameOver ? (
              <div className="flex flex-col items-center gap-4">
                {(() => {
                  const maxScore = Math.max(...players.map((p) => p.score));
                  const names = players
                    .map((p, i) => ({ score: p.score, label: PLAYER_LABELS[i] }))
                    .filter(({ score }) => score === maxScore)
                    .map(({ label }) => label)
                    .join(", ");
                  return (
                    <span className="text-base font-bold text-yellow-300">
                      최종 소지금 {maxScore.toLocaleString()}으로 {names} 우승!
                    </span>
                  );
                })()}
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

              {/* Roll button — space always reserved; hidden in post-roll or on LLM turns */}
              <button
                className={[
                  "px-6 py-3 bg-gray-600 hover:bg-gray-500 active:bg-gray-700",
                  "rounded-xl font-bold text-sm transition-colors",
                  turnPhase !== "pre-roll" || current.isLLM ? "invisible pointer-events-none" : "",
                ].join(" ")}
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
              {scoringAnim !== null && scoreDeltaPopups[player.color] ? (
                <p
                  key={scoreDeltaPopups[player.color]!.key}
                  className="text-sm font-bold text-yellow-300"
                  style={{ animation: "score-popup 1200ms ease-out forwards" }}
                >
                  +{scoreDeltaPopups[player.color]!.amount.toLocaleString()}
                </p>
              ) : (
                <p className={`text-xs text-yellow-400 animate-pulse ${isActive ? "" : "invisible"}`}>
                  생각 중...
                </p>
              )}
              <PlayerPanel
                player={player}
                label={PLAYER_LABELS[i]}
                isActive={isActive}
                displayScore={scoringAnim !== null ? displayScores[player.color] : undefined}
              />
            </div>
          );
        })}
      </section>

      {/* ── Floating exit button ────────────────────────────────────────── */}
      <button
        className="fixed right-4 bottom-28 w-12 h-12 rounded-full bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-900 border border-zinc-600 flex items-center justify-center transition-colors shadow-lg"
        onClick={() => setShowExitConfirm(true)}
        aria-label="나가기"
      >
        <Image src="/img/exit.png" alt="나가기" width={24} height={24} />
      </button>

      {/* ── Exit confirmation modal ──────────────────────────────────────── */}
      {showExitConfirm && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
          onClick={() => setShowExitConfirm(false)}
        >
          <div
            className="bg-zinc-800 border border-zinc-600 rounded-2xl px-8 py-6 flex flex-col items-center gap-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-sm font-semibold text-white">메인 화면으로 돌아가시겠습니까?</span>
            <div className="flex gap-3">
              <button
                className="px-6 py-2.5 bg-blue-700 hover:bg-blue-600 active:bg-blue-800 rounded-xl text-sm font-bold transition-colors"
                onClick={handleGoMain}
              >
                예
              </button>
              <button
                className="px-6 py-2.5 bg-gray-700 hover:bg-gray-600 active:bg-gray-800 rounded-xl text-sm font-bold transition-colors"
                onClick={() => setShowExitConfirm(false)}
              >
                아니오
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
