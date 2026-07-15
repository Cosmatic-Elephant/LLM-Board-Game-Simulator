export function AIBadge({ on }: { on: boolean }) {
  return (
    <div
      className={[
        "w-12 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0",
        on ? "bg-yellow-500 text-black" : "bg-zinc-600",
      ].join(" ")}
    >
      {on ? "AI" : ""}
    </div>
  );
}
