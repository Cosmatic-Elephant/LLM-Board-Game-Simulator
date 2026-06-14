import type {
  Color,
  CasinoNumber,
  CasinoState,
  CasinoScoreResult,
  RoundScoreResult,
} from "@/types/game";
import { CASINO_NUMBERS } from "@/lib/bill-setup";

/**
 * Scores a single casino after a round ends.
 *
 * Algorithm:
 * 1. Collect players who placed at least one die.
 * 2. Sort by dice count descending.
 * 3. Walk through count levels: if multiple players share the same count
 *    at a given rank, they are ALL eliminated from the payout.
 * 4. Each surviving ranked player takes the next bill in descending order.
 * 5. Leftover bills are returned to the deck.
 */
export function scoreCasino(
  casino: CasinoState,
  activeColors: Color[]
): CasinoScoreResult {
  const entries = activeColors
    .map((color) => ({ color, count: casino.dice[color] }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count);

  const payouts: Partial<Record<Color, number>> = {};
  let billIndex = 0;
  let i = 0;

  while (i < entries.length && billIndex < casino.bills.length) {
    const currentCount = entries[i].count;

    // Collect all players tied at this count level
    const tied: typeof entries = [];
    while (i < entries.length && entries[i].count === currentCount) {
      tied.push(entries[i]);
      i++;
    }

    if (tied.length > 1) {
      // Tie → all eliminated, no bills awarded at this level
      continue;
    }

    payouts[tied[0].color] = casino.bills[billIndex];
    billIndex++;
  }

  return {
    payouts,
    returnedBills: casino.bills.slice(billIndex),
  };
}

/**
 * Scores all 6 casinos and returns aggregate results.
 */
export function scoreRound(
  casinos: Record<CasinoNumber, CasinoState>,
  activeColors: Color[]
): RoundScoreResult {
  const totalPayouts: Partial<Record<Color, number>> = {};
  const returnedBills: number[] = [];
  const casinoResults = {} as Record<CasinoNumber, CasinoScoreResult>;

  for (const num of CASINO_NUMBERS) {
    const result = scoreCasino(casinos[num], activeColors);
    casinoResults[num] = result;

    for (const [color, amount] of Object.entries(result.payouts) as [
      Color,
      number,
    ][]) {
      totalPayouts[color] = (totalPayouts[color] ?? 0) + amount;
    }

    returnedBills.push(...result.returnedBills);
  }

  return { totalPayouts, returnedBills, casinoResults };
}
