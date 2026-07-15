export function SelectField({
  value,
  onChange,
  children,
}: {
  value: string | number;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative w-full">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-700 border border-zinc-600 rounded-lg pl-3 pr-8 py-2 text-sm text-white appearance-none cursor-pointer focus:outline-none focus:border-zinc-400"
      >
        {children}
      </select>
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 text-xs">
        ▽
      </span>
    </div>
  );
}
