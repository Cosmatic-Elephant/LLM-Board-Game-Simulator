import { NextRequest, NextResponse } from "next/server";
import { getLLMAction, llmResponseToAction } from "@/lib/llm-client";
import { isValidAction } from "@/lib/game-engine";
import type { LLMGameState } from "@/types/game";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { modelId: string; payload: LLMGameState };
    const { modelId, payload } = body;

    if (!modelId || !payload) {
      return NextResponse.json({ error: "modelId and payload are required" }, { status: 400 });
    }

    const response = await getLLMAction(modelId, payload);
    const action = llmResponseToAction(response);

    // Re-validate on the server side so a tampered LLM response can't cheat
    const roll = Object.entries(payload.my_roll).flatMap(([face, count]) =>
      Array(count).fill(Number(face))
    );

    if (!isValidAction(action, roll)) {
      return NextResponse.json({ error: "LLM returned an invalid action" }, { status: 422 });
    }

    // Return response.action (dice_count snake_case) so the client can read it as-is
    return NextResponse.json({ action: response.action, reasoning: response.reasoning });
  } catch (err) {
    console.error("[llm-action]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
