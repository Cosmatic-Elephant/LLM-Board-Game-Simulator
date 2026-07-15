import { DEFAULT_SLOT_MODEL_ID, type ColorKey } from "@/lib/constants";

export const MODEL_OPTIONS = [
  { value: "claude-sonnet-4-6", label: "claude-sonnet-4-6" },
  { value: "gpt-4o", label: "gpt-4o" },
  { value: "gemini-pro", label: "gemini-pro" },
  { value: "meta/llama-3.1-70b-instruct", label: "Llama 3.1 70B" },
  { value: "zhipuai/glm-4", label: "GLM-4 (무료)" },
  { value: "깡통", label: "깡통" },
] as const;
export const CUTOFF_OPTIONS = [50000, 60000, 70000, 80000, 90000, 100000];

// 멀티플레이 방 슬롯(0~3번)이 아직 게스트가 입장하지 않은 "AI 슬롯"일 때의 기본 모델 배열.
export const DEFAULT_SLOT_MODELS: string[] = Array(4).fill(DEFAULT_SLOT_MODEL_ID);

export const STORAGE_PLAYERS_KEY  = "las-vegas:playerConfig";
export const STORAGE_SETTINGS_KEY = "las-vegas:gameSettings";
export const STORAGE_MULTIPLAYER_NAME_KEY = "las-vegas:multiplayerName";

export interface PlayerSlot {
  color: ColorKey;
  name: string;
  isAI: boolean;
  modelId: string;
}

export const DEFAULT_PLAYERS: PlayerSlot[] = [
  { color: "red",    name: "플레이어 1", isAI: false, modelId: "claude-sonnet-4-6" },
  { color: "yellow", name: "플레이어 2", isAI: false, modelId: "claude-sonnet-4-6" },
  { color: "green",  name: "플레이어 3", isAI: false, modelId: "claude-sonnet-4-6" },
  { color: "blue",   name: "플레이어 4", isAI: false, modelId: "claude-sonnet-4-6" },
];
