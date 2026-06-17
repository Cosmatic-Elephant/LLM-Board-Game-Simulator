// ─── Primitives ───────────────────────────────────────────────────────────────

export type Color = "red" | "yellow" | "green" | "blue";

export type CasinoNumber = 1 | 2 | 3 | 4 | 5 | 6;

// ─── Player ───────────────────────────────────────────────────────────────────

export interface PlayerConfig {
  color: Color;
  isLLM: boolean;
  /** e.g. "claude-sonnet-4-6", "gpt-4o". Required when isLLM is true. */
  modelId?: string;
}

export interface PlayerState extends PlayerConfig {
  score: number;
  diceRemaining: number;
}

// ─── Casino ───────────────────────────────────────────────────────────────────

export interface CasinoState {
  /** Bills sorted descending, e.g. [70000, 30000] */
  bills: number[];
  /** How many dice each active color has placed here this round */
  dice: Record<Color, number>;
}

// ─── Action ───────────────────────────────────────────────────────────────────

export interface Action {
  casino: CasinoNumber;
  /** Number of dice being placed (all dice showing that face) */
  diceCount: number;
}

// ─── Internal Game State ──────────────────────────────────────────────────────

export type GamePhase =
  | "lobby"          // Player setup screen
  | "round-setup"    // Distributing bills to casinos
  | "rolling"        // Waiting for current player to roll (or auto-rolling for LLM)
  | "awaiting-action" // Waiting for human input or LLM response
  | "scoring"        // Calculating end-of-round payouts
  | "round-end"      // Showing round results before next round
  | "game-end";      // Final scores

export interface GameState {
  phase: GamePhase;
  round: number;
  /** Global turn counter (increments each time a player places dice) */
  turn: number;
  /** Index into `players` array */
  currentPlayerIndex: number;
  players: PlayerState[];
  casinos: Record<CasinoNumber, CasinoState>;
  /** Bills not yet distributed to casinos */
  billDeck: number[];
  /** Raw dice values of the current roll, null when no roll is active */
  currentRoll: number[] | null;
  lastAction: Action | null;
  /** Reasoning string returned by the LLM on its last turn */
  lastReasoning?: string;
}

// ─── LLM Payload (matches DESIGN.md JSON schema) ─────────────────────────────

export interface LLMGameState {
  game: {
    round: number;
    turn: number;
  };
  casinos: {
    [casinoNumber: string]: {
      bills: number[];
      dice: Record<Color, number>;
    };
  };
  players: {
    [color in Color]?: {
      is_llm: boolean;
      score: number;
      dice_remaining: number;
    };
  };
  my_color: Color;
  /** Face value → count, e.g. { "3": 2, "5": 2, "6": 1 } */
  my_roll: Record<string, number>;
  valid_actions: Array<{
    casino: number;
    dice_count: number;
  }>;
}

export interface LLMResponse {
  action: {
    casino: number;
    dice_count: number;
  };
  reasoning?: string;
}

// ─── Round Scoring Result ─────────────────────────────────────────────────────

export interface CasinoScoreResult {
  /** Bills awarded per color */
  payouts: Partial<Record<Color, number>>;
  /** Bills with no recipient, returned to deck */
  returnedBills: number[];
}

export interface RoundScoreResult {
  /** Total earnings per color across all casinos this round */
  totalPayouts: Partial<Record<Color, number>>;
  /** All bills returned to deck across all casinos */
  returnedBills: number[];
  /** Per-casino breakdown */
  casinoResults: Record<CasinoNumber, CasinoScoreResult>;
}

// ─── Scoring Steps (staged animation support) ─────────────────────────────────

/** One rank level in a casino's scoring sequence. */
export type CasinoRankEvent =
  | { kind: "tie-eliminated"; colors: Color[] }
  | { kind: "payout"; color: Color; billIndex: number; amount: number };

/**
 * Ordered sequence produced by computeScoringSteps().
 *
 * casino-reveal  ×6  — per-casino payout data + rank events for animation.
 * score-update   ×1  — aggregate deltas and returned bills; applied to state last.
 */
export type ScoringStep =
  | {
      kind: "casino-reveal";
      casinoNumber: CasinoNumber;
      payouts: Partial<Record<Color, number>>;
      returnedBills: number[];
      events: CasinoRankEvent[];
    }
  | {
      kind: "score-update";
      deltaByColor: Partial<Record<Color, number>>;
      returnedBills: number[];
    };
