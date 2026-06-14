import type {
  Color,
  CasinoNumber,
  CasinoState,
  PlayerConfig,
  PlayerState,
  GameState,
  Action,
  LLMGameState,
} from "@/types/game";
import {
  CASINO_NUMBERS,
  createBillDeck,
  distributeRound,
} from "@/lib/bill-setup";
import { scoreRound } from "@/lib/scoring";

// ─── Constants ────────────────────────────────────────────────────────────────

export const COLORS: Color[] = ["red", "yellow", "green", "blue"];
export const DICE_PER_PLAYER = 8;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Roll `count` standard six-sided dice. Returns array of face values 1–6. */
export function rollDice(count: number): number[] {
  return Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1);
}

/**
 * Groups dice by face value.
 * e.g. [1,1,1,3,3,5] → { 1: 3, 3: 2, 5: 1 }
 */
export function groupDice(roll: number[]): Record<number, number> {
  const groups: Record<number, number> = {};
  for (const face of roll) {
    groups[face] = (groups[face] ?? 0) + 1;
  }
  return groups;
}

/**
 * Derives all valid actions from a dice roll.
 * Each unique face value maps to one action (place all dice showing that face).
 */
export function getValidActions(roll: number[]): Action[] {
  return Object.entries(groupDice(roll)).map(([face, count]) => ({
    casino: Number(face) as CasinoNumber,
    diceCount: count,
  }));
}

function emptyDice(): Record<Color, number> {
  return { red: 0, yellow: 0, green: 0, blue: 0 };
}

function createEmptyCasinos(): Record<CasinoNumber, CasinoState> {
  const casinos = {} as Record<CasinoNumber, CasinoState>;
  for (const n of CASINO_NUMBERS) {
    casinos[n] = { bills: [], dice: emptyDice() };
  }
  return casinos;
}

/** Cheap deep-clone for plain game state (no functions or class instances). */
function clone<T>(val: T): T {
  return JSON.parse(JSON.stringify(val));
}

// ─── State Initialisation ─────────────────────────────────────────────────────

/**
 * Creates a fresh GameState from player configuration.
 * Phase is set to "round-setup" — call `setupRound` next.
 */
export function createInitialState(configs: PlayerConfig[]): GameState {
  const players: PlayerState[] = configs.map((c) => ({
    ...c,
    score: 0,
    diceRemaining: DICE_PER_PLAYER,
  }));

  return {
    phase: "round-setup",
    round: 0,
    turn: 0,
    currentPlayerIndex: 0,
    players,
    casinos: createEmptyCasinos(),
    billDeck: createBillDeck(),
    currentRoll: null,
    lastAction: null,
  };
}

// ─── Round Lifecycle ──────────────────────────────────────────────────────────

/**
 * Distributes bills to casinos for a new round.
 *
 * Returns the new state with phase "rolling" and a randomly chosen
 * starting player, or phase "game-end" if there aren't enough bills.
 */
export function setupRound(state: GameState): GameState {
  const next = clone(state);
  const activeColors = next.players.map((p) => p.color);

  const result = distributeRound(next.billDeck, activeColors);

  if (result === null) {
    next.phase = "game-end";
    return next;
  }

  next.casinos = result.casinos;
  next.billDeck = result.remainingDeck;
  next.round++;
  next.turn = 0;

  // Reset dice for all players
  for (const player of next.players) {
    player.diceRemaining = DICE_PER_PLAYER;
  }

  // Random starting player
  next.currentPlayerIndex = Math.floor(Math.random() * next.players.length);
  next.phase = "rolling";
  next.currentRoll = null;
  next.lastAction = null;

  return next;
}

/**
 * Records the roll result for the current player and advances phase to
 * "awaiting-action" so either a human or LLM can choose an action.
 */
export function applyRoll(state: GameState, roll: number[]): GameState {
  const next = clone(state);
  next.currentRoll = roll;
  next.phase = "awaiting-action";
  return next;
}

/**
 * Applies a placement action: places dice on the chosen casino,
 * decrements the player's remaining dice, and advances the turn.
 *
 * If all players have exhausted their dice, transitions to "scoring".
 * Otherwise advances to the next player with dice remaining and
 * sets phase to "rolling".
 */
export function applyAction(state: GameState, action: Action): GameState {
  const next = clone(state);
  const player = next.players[next.currentPlayerIndex];

  next.casinos[action.casino].dice[player.color] += action.diceCount;
  player.diceRemaining -= action.diceCount;
  next.turn++;
  next.currentRoll = null;
  next.lastAction = action;

  const allDone = next.players.every((p) => p.diceRemaining === 0);

  if (allDone) {
    next.phase = "scoring";
  } else {
    // Advance to the next player who still has dice
    do {
      next.currentPlayerIndex =
        (next.currentPlayerIndex + 1) % next.players.length;
    } while (next.players[next.currentPlayerIndex].diceRemaining === 0);

    next.phase = "rolling";
  }

  return next;
}

/**
 * Scores the round: awards bills, updates player scores, returns leftover
 * bills to the deck, clears casino dice, and sets phase to "round-end".
 */
export function applyScoring(state: GameState): GameState {
  const next = clone(state);
  const activeColors = next.players.map((p) => p.color);

  const { totalPayouts, returnedBills } = scoreRound(next.casinos, activeColors);

  for (const player of next.players) {
    player.score += totalPayouts[player.color] ?? 0;
  }

  // Return unawarded bills to the deck
  next.billDeck.push(...returnedBills);

  // Clear dice from all casinos
  for (const num of CASINO_NUMBERS) {
    next.casinos[num].dice = emptyDice();
    next.casinos[num].bills = [];
  }

  next.phase = "round-end";
  return next;
}

// ─── LLM Payload Builder ──────────────────────────────────────────────────────

/**
 * Builds the JSON payload sent to an LLM player on their turn.
 * Shape matches the schema in DESIGN.md.
 */
export function buildLLMPayload(
  state: GameState,
  roll: number[]
): LLMGameState {
  const currentPlayer = state.players[state.currentPlayerIndex];
  const groups = groupDice(roll);
  const validActions = getValidActions(roll);

  const casinos: LLMGameState["casinos"] = {};
  for (const num of CASINO_NUMBERS) {
    casinos[String(num)] = {
      bills: state.casinos[num].bills,
      dice: state.casinos[num].dice,
    };
  }

  const players: LLMGameState["players"] = {};
  for (const p of state.players) {
    players[p.color] = {
      is_llm: p.isLLM,
      score: p.score,
      dice_remaining: p.diceRemaining,
    };
  }

  return {
    game: { round: state.round, turn: state.turn },
    casinos,
    players,
    my_color: currentPlayer.color,
    my_roll: Object.fromEntries(
      Object.entries(groups).map(([face, count]) => [face, count])
    ),
    valid_actions: validActions.map((a) => ({
      casino: a.casino,
      dice_count: a.diceCount,
    })),
  };
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Checks whether an action from the LLM/human is valid given the current roll.
 * Guards against invalid LLM responses.
 */
export function isValidAction(action: Action, roll: number[]): boolean {
  const valid = getValidActions(roll);
  return valid.some(
    (v) => v.casino === action.casino && v.diceCount === action.diceCount
  );
}

// ─── Score Helpers ────────────────────────────────────────────────────────────

/** Returns players sorted by score descending. */
export function getRankings(state: GameState): PlayerState[] {
  return [...state.players].sort((a, b) => b.score - a.score);
}
