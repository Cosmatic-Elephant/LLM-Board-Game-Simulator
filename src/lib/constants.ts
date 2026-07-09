export const PLAYER_COLORS = [
  { key: "red",    label: "빨강", hex: "#FB2C36" },
  { key: "yellow", label: "노랑", hex: "#FDC700" },
  { key: "green",  label: "초록", hex: "#00C950" },
  { key: "blue",   label: "파랑", hex: "#2B7FFF" },
  { key: "orange", label: "주황", hex: "#FF6B00" },
  { key: "purple", label: "보라", hex: "#A855F7" },
  { key: "pink",   label: "분홍", hex: "#FF69B4" },
  { key: "white",  label: "흰색", hex: "#E8E8E8" },
] as const;

export type ColorKey = typeof PLAYER_COLORS[number]["key"];

// 멀티플레이 방 슬롯(0~3번)의 기본 색상. 서버·클라이언트가 동일한 기본값을 공유하기 위한 상수.
export const DEFAULT_SLOT_COLORS: ColorKey[] = ["red", "yellow", "green", "blue"];

// 멀티플레이 방에서 게스트가 아직 입장하지 않은 슬롯(AI 슬롯)의 기본 모델.
export const DEFAULT_SLOT_MODEL_ID = "깡통";

// 게임 설정 기본값. 싱글/멀티플레이 로비와 서버(방 초기 상태)가 동일한 기본값을 공유하기 위한 상수.
export const DEFAULT_HUMAN_FIRST = true;
export const DEFAULT_CUTOFF = 50000;
