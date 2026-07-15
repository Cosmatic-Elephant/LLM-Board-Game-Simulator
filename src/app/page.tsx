"use client";

import { useState } from "react";
import { PlayerSetupPopup } from "@/components/las-vegas/PlayerSetupPopup";
import { MultiplayerPopup } from "@/components/las-vegas/MultiplayerPopup";
import { GameSelectListbox, GAME_OPTIONS } from "@/components/ui/GameSelectListbox";

export default function LobbyPage() {
  const [activePopup, setActivePopup] = useState<"single" | "multi" | null>(null);
  const [selectedGameId, setSelectedGameId] = useState("las-vegas");
  const [gameSelectOpen, setGameSelectOpen] = useState(false);

  const selectedGame = GAME_OPTIONS.find((g) => g.id === selectedGameId)!;
  const isLasVegas = selectedGameId === "las-vegas";

  function handleSinglePlayerClick() {
    if (isLasVegas) {
      setActivePopup("single");
    } else {
      console.log("요트 다이스 설정 팝업 - 미구현");
    }
  }

  return (
    <main className="relative flex flex-col items-center justify-center min-h-screen gap-4">
      <h1 className="text-4xl font-bold tracking-tight">{selectedGame.title}</h1>
      <p className="text-gray-400">{selectedGame.subtitle}</p>
      <div className="mt-4 flex gap-4">
        <button
          onClick={handleSinglePlayerClick}
          className="px-8 py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-lg rounded-xl transition-colors"
        >
          싱글플레이
        </button>
        <button
          onClick={() => isLasVegas && setActivePopup("multi")}
          disabled={!isLasVegas}
          className="px-8 py-3 bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-lg rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-yellow-500"
        >
          멀티플레이
        </button>
      </div>

      <div className="absolute bottom-6">
        <button
          onClick={() => setGameSelectOpen((v) => !v)}
          className="px-6 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-400 font-semibold text-sm rounded-xl transition-colors"
        >
          게임 변경
        </button>
        {gameSelectOpen && (
          <GameSelectListbox
            selectedId={selectedGameId}
            onSelect={setSelectedGameId}
            onClose={() => setGameSelectOpen(false)}
          />
        )}
      </div>

      {activePopup === "single" && (
        <PlayerSetupPopup title="싱글 플레이어 설정" onClose={() => setActivePopup(null)} />
      )}
      {activePopup === "multi" && (
        <MultiplayerPopup onClose={() => setActivePopup(null)} />
      )}
    </main>
  );
}
