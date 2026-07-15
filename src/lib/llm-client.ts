import type { LLMGameState, LLMResponse, Action, CasinoNumber } from "@/types/game";

// ─── Provider Detection ───────────────────────────────────────────────────────

type Provider = "anthropic" | "openai" | "google" | "nvidia";

function detectProvider(modelId: string): Provider {
  if (modelId.startsWith("claude")) return "anthropic";
  if (modelId.startsWith("gpt") || modelId.startsWith("o1") || modelId.startsWith("o3")) return "openai";
  if (modelId.startsWith("gemini")) return "google";
  // NVIDIA NIM 카탈로그 모델은 "meta/llama-3.1-70b-instruct"처럼 항상 네임스페이스/모델명 형태(슬래시 포함)이며,
  // NVIDIA API 키 자체도 "nvapi-" 접두사를 쓴다.
  if (modelId.startsWith("nvapi-") || modelId.includes("/")) return "nvidia";
  throw new Error(`Cannot detect provider for model: ${modelId}`);
}

// ─── System Prompt ────────────────────────────────────────────────────────────

/** Full system prompt from docs/las-vegas/DESIGN.md, sent on every LLM call. */
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

### Strategy

Winning means accumulating the most total money by game end — not necessarily controlling the single biggest casino. A few principles to weigh each turn:

- **Dice efficiency**: dice are limited (8 per round). Committing many dice to win a low-value bill may be a worse trade than a smaller commitment securing a similar payout elsewhere.
- **Spreading risk**: securing 2nd or 3rd place at one casino can sometimes beat fighting for 1st at a contested one.
- **Tie exploitation**: if two players are already tied at a casino, both are eliminated from that casino's payout — even a single die added by a third player can claim an otherwise-uncontested rank. Don't assume you're "competing" with the tied players; they're already out.

---

## Your Input Format

Each turn you will receive a JSON object describing the full game state. Key fields:
- casinos: each casino's remaining bills and current dice placement per player
- players: each player's score and remaining dice count
- my_color: your assigned color
- my_roll: the result of your current dice roll (face value → count)
- valid_actions: the list of legal actions you may take this turn

## Your Output Format

Respond with ONLY the JSON object below — no text before or after it, no markdown code fences, no analysis outside the JSON.

Make your decision quickly using the Strategy principles above. This is a casual game among friends, not a competition requiring exhaustive analysis — go with your gut once you have a reasonable read on the board. State only your final choice with a brief reason (1-2 sentences, in Korean) inside the "reasoning" field. Do not deliberate over multiple options in text outside the JSON.

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
    max_tokens: 700,
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
    max_tokens: 700,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(payload, null, 2) },
    ],
  });

  const text = completion.choices[0]?.message?.content ?? "";
  return parseResponse(text, payload);
}

async function callNvidia(
  modelId: string,
  payload: LLMGameState
): Promise<LLMResponse> {
  // NVIDIA NIM은 OpenAI 호환 API를 제공하므로 openai SDK를 그대로 재사용하고, baseURL/apiKey만 교체한다.
  const OpenAI = (await import("openai")).default;
  const client = new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: "https://integrate.api.nvidia.com/v1",
  });

  const completion = await client.chat.completions.create({
    model: modelId,
    max_tokens: 700,
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
    config: { systemInstruction: SYSTEM_PROMPT, maxOutputTokens: 700 },
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
    // Strip markdown code fences if present, then extract the outermost {...} object
    // to tolerate surrounding prose text that some models emit despite the prompt.
    const stripped = raw.replace(/```(?:json)?\s*([\s\S]*?)```/g, "$1").trim();
    const objMatch = stripped.match(/\{[\s\S]*\}/);
    if (!objMatch) throw new Error("no JSON object found");
    const jsonText = objMatch[0];
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
  } catch (e) {
    console.warn("[LLM] parseResponse failed — raw text below:", e);
    console.warn(raw);
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
    case "nvidia":
      return callNvidia(modelId, payload);
  }
}

/** Converts an LLMResponse action to the internal Action type. */
export function llmResponseToAction(response: LLMResponse): Action {
  return {
    casino: response.action.casino as CasinoNumber,
    diceCount: response.action.dice_count,
  };
}
