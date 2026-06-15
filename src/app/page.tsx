import Link from "next/link";

export default function LobbyPage() {
  return (
    <main className="flex flex-col items-center justify-center min-h-screen gap-4">
      <h1 className="text-4xl font-bold tracking-tight">Las Vegas Simulator</h1>
      <p className="text-gray-400">Lobby — player setup coming soon</p>
      <Link
        href="/game"
        className="mt-4 px-8 py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-lg rounded-xl transition-colors"
      >
        게임 시작
      </Link>
    </main>
  );
}
