export function ReadOnlyBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full bg-zinc-700 border border-zinc-600 rounded-lg px-3 py-2 text-sm text-white">
      {children}
    </div>
  );
}
