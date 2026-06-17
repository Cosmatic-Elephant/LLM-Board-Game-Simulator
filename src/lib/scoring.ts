import type {
  Color,
  CasinoNumber,
  CasinoState,
  CasinoScoreResult,
  CasinoRankEvent,
  RoundScoreResult,
  ScoringStep,
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
 *
 * Prefer computeScoringSteps() when you need staged animation support.
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

/**
 * Produces the ordered rank events for one casino, mirroring scoreCasino's logic.
 * Used by computeScoringSteps to drive per-casino animation sequencing.
 */
function computeCasinoRankEvents(
  casino: CasinoState,
  activeColors: Color[]
): CasinoRankEvent[] {
  const entries = activeColors
    .map((color) => ({ color, count: casino.dice[color] }))
    .filter(({ count }) => count > 0)
    .sort((a, b) => b.count - a.count);

  const events: CasinoRankEvent[] = [];
  let billIndex = 0;
  let i = 0;

  while (i < entries.length && billIndex < casino.bills.length) {
    const currentCount = entries[i].count;
    const tied: typeof entries = [];
    while (i < entries.length && entries[i].count === currentCount) {
      tied.push(entries[i]);
      i++;
    }

    if (tied.length > 1) {
      events.push({ kind: "tie-eliminated", colors: tied.map((e) => e.color) });
    } else {
      events.push({
        kind: "payout",
        color: tied[0].color,
        billIndex,
        amount: casino.bills[billIndex],
      });
      billIndex++;
    }
  }

  return events;
}

/**
 * Runs scoreRound() once and wraps the results as an ordered step sequence.
 *
 * Steps 1–6: "casino-reveal" — per-casino payouts, returned bills, and rank events
 *            for driving the animation sequence.
 * Step 7:    "score-update"  — total deltas and all returned bills for final state update.
 */
export function computeScoringSteps(
  casinos: Record<CasinoNumber, CasinoState>,
  activeColors: Color[]
): ScoringStep[] {
  const { casinoResults, totalPayouts, returnedBills } = scoreRound(
    casinos,
    activeColors
  );

  const steps: ScoringStep[] = CASINO_NUMBERS.map((n) => ({
    kind: "casino-reveal" as const,
    casinoNumber: n,
    payouts: casinoResults[n].payouts,
    returnedBills: casinoResults[n].returnedBills,
    events: computeCasinoRankEvents(casinos[n], activeColors),
  }));

  steps.push({
    kind: "score-update",
    deltaByColor: totalPayouts,
    returnedBills,
  });

  return steps;
}
