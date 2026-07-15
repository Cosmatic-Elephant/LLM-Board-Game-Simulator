export function Toggle({ on, onToggle, disabled = false }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={[
        "relative w-12 h-6 rounded-full transition-colors flex-shrink-0",
        disabled ? "opacity-35 cursor-not-allowed" : "",
        on ? "bg-yellow-500" : "bg-zinc-600",
      ].join(" ")}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? "translate-x-6" : "translate-x-0"}`}
      />
    </button>
  );
}
