export function PopupHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-bold text-white">{title}</span>
      <button
        onClick={onClose}
        className="text-gray-400 hover:text-white text-lg leading-none transition-colors"
      >
        ✕
      </button>
    </div>
  );
}
