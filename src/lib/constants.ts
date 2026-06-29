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
