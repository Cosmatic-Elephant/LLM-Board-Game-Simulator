import { PLAYER_COLORS, type ColorKey } from "@/lib/constants";

export function ColorDisplay({ value }: { value: ColorKey }) {
  const selected = PLAYER_COLORS.find((c) => c.key === value)!;
  return (
    <div className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white flex items-center gap-2">
      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: selected.hex }} />
      <span className="flex-1 text-left">{selected.label}</span>
    </div>
  );
}
