import type { Color, CasinoNumber, CasinoState } from "@/types/game";

export const CASINO_NUMBERS: CasinoNumber[] = [1, 2, 3, 4, 5, 6];

/** Total bill counts per denomination, per DESIGN.md */
const BILL_SPEC: [number, number][] = [
  [10000, 8],
  [20000, 8],
  [30000, 8],
  [40000, 6],
  [50000, 5],
  [60000, 5],
  [70000, 5],
  [80000, 5],
  [90000, 3],
  [100000, 1],
];

export function createBillDeck(): number[] {
  const deck: number[] = [];
  for (const [value, count] of BILL_SPEC) {
    for (let i = 0; i < count; i++) {
      deck.push(value);
    }
  }
  return deck;
}

export function shuffle<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function emptyDice(): Record<Color, number> {
  return { red: 0, yellow: 0, green: 0, blue: 0, orange: 0, purple: 0, pink: 0, white: 0 };
}

export interface DistributeResult {
  casinos: Record<CasinoNumber, CasinoState>;
  remainingDeck: number[];
}

/**
 * Distributes bills from the deck to the 6 casinos for a new round.
 *
 * Rule: keep drawing bills for a casino until its total >= 50,000,
 * then move to the next casino. Bills on each casino are sorted descending.
 *
 * Returns null if the deck runs out before all 6 casinos are set up
 * (this signals game-end to the caller).
 */
export function distributeRound(
  billDeck: number[],
  activeColors: Color[],
  cutline = 50000
): DistributeResult | null {
  const shuffled = shuffle([...billDeck]);
  let deckIndex = 0;

  const casinos = {} as Record<CasinoNumber, CasinoState>;

  for (const casinoNum of CASINO_NUMBERS) {
    const casinoBills: number[] = [];

    while (true) {
      if (deckIndex >= shuffled.length) {
        return null; // not enough bills → game ends
      }
      casinoBills.push(shuffled[deckIndex++]);
      const total = casinoBills.reduce((sum, b) => sum + b, 0);
      if (total >= cutline || casinoBills.length >= activeColors.length) break;
    }

    casinoBills.sort((a, b) => b - a);

    casinos[casinoNum] = {
      bills: casinoBills,
      dice: emptyDice(),
    };
  }

  return {
    casinos,
    remainingDeck: shuffled.slice(deckIndex),
  };
}
