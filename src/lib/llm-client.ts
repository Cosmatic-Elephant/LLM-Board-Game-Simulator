import type { LLMGameState, LLMResponse, Action, CasinoNumber } from "@/types/game";

// ─── Provider Detection ───────────────────────────────────────────────────────

type Provider = "anthropic" | "openai" | "google";

function detectProvider(modelId: string): Provider {
  if (modelId.startsWith("claude")) return "anthropic";
  if (modelId.startsWith("gpt") || modelId.startsWith("o1") || modelId.startsWith("o3")) return "openai";
  if (modelId.startsWith("gemini")) return "google";
  throw new Error(`Cannot detect provider for model: ${modelId}`);
}

// ─── System Prompt ────────────────────────────────────────────────────────────

/** Full system prompt from DESIGN.md, sent on every LLM call. */
const SYSTEM_PROMPT = `You are a player in a board game called Las Vegas. You will receive the current game state as JSON and must decide which casino to place your dice at.

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

## Your Input Format

Each turn you will receive a JSON object describing the full game state. Key fields:
- casinos: each casino's remaining bills and current dice placement per player
- players: each player's score and remaining dice count
- my_color: your assigned color
- my_roll: the result of your current dice roll (face value → count)
- valid_actions: the list of legal actions you may take this turn

## Your Output Format

Respond with ONLY the following JSON. Do not include any explanation outside of the JSON block.

**Important:** Use the exact field name "dice_count" (snake_case). Do NOT use "diceCount".

{
  "action": {
    "casino": 5,
    "dice_count": 2
  },
  "reasoning": "Casino 1 has a tie risk between red and green. Securing casino 5 with 80,000 as the current leader is a safer play."
}

Your chosen action must exactly match one of the entries in valid_actions (same casino number and same dice_count). Do not invent actions outside this list.`;

// ─── Provider Implementations ─────────────────────────────────────────────────

async function callAnthropic(
  modelId: string,
  payload: LLMGameState
): Promise<LLMResponse> {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: modelId,
    max_tokens: 150,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: JSON.stringify(payload, null, 2) }],
  });

  const text =
    message.content[0].type === "text" ? message.content[0].text : "";
  return parseResponse(text, payload);
}

async function callOpenAI(
  modelId: string,
  payload: LLMGameState
): Promise<LLMResponse> {
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const completion = await client.chat.completions.create({
    model: modelId,
    max_tokens: 150,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(payload, null, 2) },
    ],
  });

  const text = completion.choices[0]?.message?.content ?? "";
  return parseResponse(text, payload);
}

async function callGoogle(
  modelId: string,
  payload: LLMGameState
): Promise<LLMResponse> {
  const { GoogleGenAI } = await import("@google/genai");
  const client = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

  const response = await client.models.generateContent({
    model: modelId,
    contents: JSON.stringify(payload, null, 2),
    config: { systemInstruction: SYSTEM_PROMPT, maxOutputTokens: 150 },
  });

  const text = response.text ?? "";
  return parseResponse(text, payload);
}

// ─── Response Parser ──────────────────────────────────────────────────────────

/**
 * Parses the LLM's raw text response into a typed LLMResponse.
 * Falls back to the first valid action if parsing fails.
 */
function parseResponse(raw: string, payload: LLMGameState): LLMResponse {
  try {
    // Strip markdown code fences if present
    const jsonText = raw.replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1").trim();
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;

    // Normalize camelCase diceCount → snake_case dice_count when LLM ignores the prompt
    const action = parsed.action as Record<string, unknown> | undefined;
    if (action && action.diceCount !== undefined && action.dice_count === undefined) {
      action.dice_count = action.diceCount;
    }

    const response = parsed as unknown as LLMResponse;
    const chosen = response.action;
    const isValid = payload.valid_actions.some(
      (a) => a.casino === chosen.casino && a.dice_count === chosen.dice_count
    );

    if (isValid) return response;
  } catch {
    // Fall through to fallback
  }

  // Fallback: pick the first valid action
  const fallback = payload.valid_actions[0];
  return {
    action: { casino: fallback.casino, dice_count: fallback.dice_count },
    reasoning: "[fallback: LLM response could not be parsed]",
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Calls the appropriate LLM provider and returns a validated action.
 * Intended to be called from the Next.js API route (server-side only).
 */
export async function getLLMAction(
  modelId: string,
  payload: LLMGameState
): Promise<LLMResponse> {
  const provider = detectProvider(modelId);

  switch (provider) {
    case "anthropic":
      return callAnthropic(modelId, payload);
    case "openai":
      return callOpenAI(modelId, payload);
    case "google":
      return callGoogle(modelId, payload);
  }
}

/** Converts an LLMResponse action to the internal Action type. */
export function llmResponseToAction(response: LLMResponse): Action {
  return {
    casino: response.action.casino as CasinoNumber,
    diceCount: response.action.dice_count,
  };
}
