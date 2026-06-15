# Las Vegas Board Game Simulator — Design Document

## Project Overview

A local-execution board game simulator for **Las Vegas** (dice placement game), supporting a flexible mix of human and LLM players. The primary goal is hands-on experience with external LLM API integration.

- **Runtime**: Local only (`npm run dev`)
- **Stack**: Next.js + TypeScript + Tailwind CSS
- **LLM API keys**: Configured via `.env` file by the user
- **Players**: Up to 4, any combination of human and LLM
- **Deployment**: Not intended for public deployment

---

## Game Rules

### Components

- 6 casinos, numbered 1 through 6
- 32 dice total — 8 each in Red, Yellow, Green, Blue
- 54 bills:
  - 10,000 x 8
  - 20,000 x 8
  - 30,000 x 8
  - 40,000 x 6
  - 50,000 x 5
  - 60,000 x 5
  - 70,000 x 5
  - 80,000 x 5
  - 90,000 x 3
  - 100,000 x 1

### Game Overview

Players roll dice and place them on casinos. After all dice are placed, each casino pays out to the player(s) with the most dice there. The player with the most total money at game end wins.

### Round Setup

Bills are distributed to casinos in order from casino 1 to casino 6:

1. Draw a random bill from the shuffled pile.
2. Place it on the current casino.
3. Sum all bills on that casino.
4. If the total is under 50,000 — continue adding to the same casino.
5. If the total is 50,000 or more — move on to the next casino.
6. After all casinos are set up, sort each casino's bills in descending order.

### Round Progression

1. The starting player is chosen randomly. (Future option: last player of previous round, or player with least money.)
2. On your turn, roll all your remaining dice at once.
3. Choose a casino number that appears in your roll.
4. Place ALL dice showing that number onto that casino.
5. Pass to the next player.
6. Repeat until all players have exhausted their dice → round ends.

### Placement Rules

- You may only place dice on a casino if your roll includes that casino's number.
- You must place all dice showing the chosen number — partial placement is not allowed.
- You may add dice to a casino where you have already placed dice this round.
- You may add dice to a casino where other players have already placed dice.
- There is no situation where placement is physically impossible — at least one valid action always exists.

### Scoring

After all players exhaust their dice, each casino is scored:

1. Check how many dice each player has at this casino.
2. If two or more players have the same count — all tied players are eliminated from this casino's payout.
3. Rank remaining players by dice count (highest to lowest).
4. 1st place takes the largest bill, 2nd place takes the next largest, and so on.
5. Each ranked player receives exactly one bill.
6. Any bills with no recipient are returned to the bill pile.
7. All dice are returned to their owners.

### Game End

At the start of each new round setup, if there are not enough bills remaining to complete the setup, the game ends. Players are prompted to either end the game and tally scores, or continue into the next round.

The player with the highest total money wins.

---

## Example: One Full Cycle

### Round Setup

| Casino | Bills |
|--------|-------|
| 1 | 70,000 / 30,000 |
| 2 | 90,000 |
| 3 | 60,000 / 40,000 |
| 4 | 100,000 |
| 5 | 80,000 / 20,000 |
| 6 | 50,000 / 30,000 / 20,000 |

All players start with 8 dice. Starting player: Red (random).

---

### Red's First Turn

Roll: `1 1 1 3 3 5 5 6`

Available choices:
- Casino 1 → place 3 dice (three 1s)
- Casino 3 → place 2 dice (two 3s)
- Casino 5 → place 2 dice (two 5s)
- Casino 6 → place 1 die (one 6)

→ Red chooses **casino 1**. Places 3 dice.
→ Remaining: `3 3 5 5 6` (5 dice)

---

### Yellow's First Turn

Roll: `1 1 3 4 4 4 6 6`

Available choices:
- Casino 1 → place 2 dice
- Casino 3 → place 1 die
- Casino 4 → place 3 dice
- Casino 6 → place 2 dice

→ Yellow chooses **casino 4**. Places 3 dice.
→ Remaining: `1 1 3 6 6` (5 dice)

---

### Green's First Turn

Roll: `1 1 2 2 3 5 5 5`

Available choices:
- Casino 1 → place 2 dice
- Casino 2 → place 2 dice
- Casino 3 → place 1 die
- Casino 5 → place 3 dice

→ Green chooses **casino 1**. Places 2 dice.
→ Remaining: `2 2 3 5 5 5` (6 dice)

> ※ Casino 1 now has Red: 3 dice, Green: 2 dice.
> Placing on a casino already occupied by another player is always allowed.

---

### Blue's First Turn

Roll: `2 3 3 3 4 5 6 6`

Available choices:
- Casino 2 → place 1 die
- Casino 3 → place 3 dice
- Casino 4 → place 1 die
- Casino 5 → place 1 die
- Casino 6 → place 2 dice

→ Blue chooses **casino 3**. Places 3 dice.
→ Remaining: `2 4 5 6 6` (5 dice)

---

### Red's Second Turn

Roll: `3 3 5 5 6`

Casino 1 current status: Red 3 dice, Green 2 dice.

Available choices:
- Casino 3 → place 2 dice
- Casino 5 → place 2 dice
- Casino 6 → place 1 die

→ Red chooses **casino 5**. Places 2 dice.
→ Remaining: `3 3 6` (3 dice)

> ※ Red has no 1s this roll, so adding to casino 1 is not possible this turn.
> However, if Red had rolled a 1, placing additional dice on casino 1 — where Red already has dice — would be a valid and strategic move.
> For example: if Green later catches up to 3 dice at casino 1, a tie would eliminate both. Red adding one more die preemptively breaks that tie.

---

*… (cycle continues until all players exhaust their dice)*

---

### Scoring Example — Casino 1

Final state: Red 3 dice, Green 3 dice, Yellow 1 die

1. Red and Green are tied (3 each) → both eliminated
2. Yellow (1 die) is the sole remaining player → ranked 1st
3. Yellow takes the largest bill: **70,000**
4. The 30,000 bill has no recipient → returned to the bill pile

---

## JSON Game State Schema

Sent to the LLM player at the start of each turn.

```typescript
type Color = "red" | "yellow" | "green" | "blue";

interface GameState {
  game: {
    round: number;
    turn: number;
  };
  casinos: {
    [casinoNumber: string]: {
      bills: number[];       // descending order, e.g. [70000, 30000]
      dice: Record<Color, number>;
    };
  };
  players: {
    [color in Color]: {
      is_llm: boolean;
      score: number;
      dice_remaining: number;
    };
  };
  my_color: Color;
  my_roll: {
    [face: string]: number;  // e.g. { "3": 2, "5": 2, "6": 1 }
  };
  valid_actions: Array<{
    casino: number;
    dice_count: number;
  }>;
}
```

### Example Payload

```json
{
  "game": {
    "round": 2,
    "turn": 5
  },
  "casinos": {
    "1": {
      "bills": [70000, 30000],
      "dice": { "red": 3, "yellow": 0, "green": 2, "blue": 0 }
    },
    "2": {
      "bills": [90000],
      "dice": { "red": 0, "yellow": 0, "green": 0, "blue": 1 }
    },
    "3": {
      "bills": [60000, 40000],
      "dice": { "red": 0, "yellow": 0, "green": 0, "blue": 3 }
    },
    "4": {
      "bills": [100000],
      "dice": { "red": 0, "yellow": 3, "green": 0, "blue": 0 }
    },
    "5": {
      "bills": [80000, 20000],
      "dice": { "red": 2, "yellow": 0, "green": 0, "blue": 0 }
    },
    "6": {
      "bills": [50000, 30000, 20000],
      "dice": { "red": 0, "yellow": 0, "green": 0, "blue": 0 }
    }
  },
  "players": {
    "red":    { "is_llm": true,  "score": 70000, "dice_remaining": 3 },
    "yellow": { "is_llm": false, "score": 0,     "dice_remaining": 5 },
    "green":  { "is_llm": true,  "score": 0,     "dice_remaining": 6 },
    "blue":   { "is_llm": false, "score": 0,     "dice_remaining": 0 }
  },
  "my_color": "red",
  "my_roll": { "3": 2, "5": 2, "6": 1 },
  "valid_actions": [
    { "casino": 3, "dice_count": 2 },
    { "casino": 5, "dice_count": 2 },
    { "casino": 6, "dice_count": 1 }
  ]
}
```

### LLM Response Schema

```json
{
  "action": {
    "casino": 5,
    "dice_count": 2
  },
  "reasoning": "Casino 1 has a tie risk between red and green. Securing casino 5 with 80,000 as the current leader is a safer play."
}
```

- `action` must be one of the options in `valid_actions`.
- `reasoning` is optional but recommended during development for debugging LLM decisions.

---

## LLM System Prompt

```
You are a player in a board game called Las Vegas. You will receive the current game state as JSON and must decide which casino to place your dice at.

---

## Goal

Accumulate the most money by the end of the game. Each round, players roll dice and place them on casinos. After all players exhaust their dice, each casino pays out to the players who placed the most dice there.

---

## Rules

### Components
- 6 casinos, numbered 1 through 6
- Each player has 8 dice of their own color
- Bills are stacked on each casino before each round (sorted in descending order)

### How a Round Works
1. On your turn, roll all your remaining dice at once.
2. Choose one casino number that matches at least one of your rolled results.
3. Place ALL dice showing that number onto that casino. You must place every die showing that number — you cannot place only some of them.
4. The turn passes to the next player.
5. Repeat until all players have exhausted all their dice.

### Placement Rules
- You may only place dice on a casino if your current roll includes that casino's number.
- You must place all dice showing the chosen number at once.
- You may place dice on a casino where you have already placed dice earlier (adding to your own stack).
- You may place dice on a casino where other players have already placed dice.
- There is no situation where placement is physically impossible.

### Scoring
After all players exhaust their dice, each casino is scored:
1. Check how many dice each player has at this casino.
2. If two or more players have the same number of dice, all of them are eliminated from this casino's payout.
3. Rank the remaining players by dice count (highest to lowest).
4. The 1st place player takes the largest bill. The 2nd place player takes the next largest bill. And so on.
5. Each player receives exactly one bill per rank. Any remaining bills with no recipient are returned to the bill pile.
6. All dice are returned to their owners.

### Game End
The game ends when there are not enough bills remaining to set up the next round. The player with the most total money wins.

---

## Example: One Full Cycle

**Setup for this round:**
- Casino 1: 70,000 / 30,000
- Casino 2: 90,000
- Casino 3: 60,000 / 40,000
- Casino 4: 100,000
- Casino 5: 80,000 / 20,000
- Casino 6: 50,000 / 30,000 / 20,000

**Red's first turn**
Roll: 1 1 1 3 3 5 5 6
Available choices: casino 1 (three 1s), casino 3 (two 3s), casino 5 (two 5s), casino 6 (one 6)
→ Red chooses casino 1. Places 3 dice there.
→ Remaining dice: 3 3 5 5 6 (5 dice)

**Yellow's first turn**
Roll: 1 1 3 4 4 4 6 6
Available choices: casino 1 (two 1s), casino 3 (one 3), casino 4 (three 4s), casino 6 (two 6s)
→ Yellow chooses casino 4. Places 3 dice there.
→ Remaining dice: 1 1 3 6 6 (5 dice)

**Green's first turn**
Roll: 1 1 2 2 3 5 5 5
Available choices: casino 1 (two 1s), casino 2 (two 2s), casino 3 (one 3), casino 5 (three 5s)
→ Green chooses casino 1. Places 2 dice there.
→ Remaining dice: 2 2 3 5 5 5 (6 dice)
※ Casino 1 now has Red: 3 dice, Green: 2 dice. Placing on a casino already occupied by another player is always allowed.

**Blue's first turn**
Roll: 2 3 3 3 4 5 6 6
Available choices: casino 2 (one 2), casino 3 (three 3s), casino 4 (one 4), casino 5 (one 5), casino 6 (two 6s)
→ Blue chooses casino 3. Places 3 dice there.
→ Remaining dice: 2 4 5 6 6 (5 dice)

**Red's second turn**
Roll: 3 3 5 5 6
Current casino 1 status: Red 3 dice, Green 2 dice.
Available choices: casino 3 (two 3s), casino 5 (two 5s), casino 6 (one 6)
→ Red chooses casino 5. Places 2 dice there.
→ Remaining dice: 3 3 6 (3 dice)
※ Red does not have any 1s this roll, so adding to casino 1 is not possible. However, if Red had rolled a 1, placing additional dice on casino 1 (where Red already has dice) would be a valid and strategic move — for example, to break a tie with Green and avoid mutual elimination.

… (the cycle continues until all players exhaust their dice)

**Scoring example — Casino 1**
Final state: Red 3 dice, Green 3 dice, Yellow 1 die
1. Red and Green are tied → both eliminated
2. Yellow (1 die) is the only remaining player → Yellow is ranked 1st
3. Yellow takes the largest bill: 70,000
4. The 30,000 bill has no recipient → returned to the bill pile

---

## Your Input Format

Each turn you will receive a JSON object describing the full game state. Key fields:
- casinos: each casino's remaining bills and current dice placement per player
- players: each player's score and remaining dice count
- my_color: your assigned color
- my_roll: the result of your current dice roll (face value → count)
- valid_actions: the list of legal actions you may take this turn

## Your Output Format

Respond with only the following JSON. Do not include any explanation outside of the JSON.

{
  "action": {
    "casino": 5,
    "dice_count": 2
  },
  "reasoning": "Casino 1 has a tie risk between red and green. Securing casino 5 with 80,000 as the current leader is a safer play."
}

Your chosen action must be one of the options listed in valid_actions. Do not invent actions outside this list.
```

---

## Project Structure (Suggested)

```
/
├── .env.local               # API keys (not committed to git)
├── app/
│   ├── page.tsx             # Game lobby (player setup)
│   ├── game/
│   │   └── page.tsx         # Main game board
│   └── api/
│       └── llm-action/
│           └── route.ts     # Server-side LLM API call
├── lib/
│   ├── game-engine.ts       # Core game logic
│   ├── bill-setup.ts        # Round bill distribution
│   ├── scoring.ts           # End-of-round scoring
│   └── llm-client.ts        # LLM API wrapper
├── types/
│   └── game.ts              # TypeScript types (GameState, Action, etc.)
└── components/
    ├── Casino.tsx            # Casino display
    ├── PlayerPanel.tsx       # Player info / dice count
    └── DiceRoll.tsx          # Dice roll display
```

---

## Environment Variables

```
# .env.local

# Choose one or more LLM providers
ANTHROPIC_API_KEY=your_key_here
OPENAI_API_KEY=your_key_here
GOOGLE_API_KEY=your_key_here

# Which model to use per LLM player slot (optional, defaults can be set in code)
LLM_PLAYER_1_MODEL=claude-sonnet-4-6
LLM_PLAYER_2_MODEL=gpt-4o
```
