import { useScoreStore } from '../../app/store/scoreStore';

export const UndoRedoToolbar = () => {
  const canUndo = useScoreStore((state) => state.canUndo);
  const canRedo = useScoreStore((state) => state.canRedo);
  const undo    = useScoreStore((state) => state.undo);
  const redo    = useScoreStore((state) => state.redo);

  return (
    <div className="sv-toolbar">
      <button
        onClick={undo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
        className={canUndo ? 'sv-btn-ghost' : 'sv-btn-ghost opacity-30 cursor-not-allowed'}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M3 10h10a5 5 0 015 5v0a5 5 0 01-5 5H9M3 10l4-4M3 10l4 4" />
        </svg>
        <span>Undo</span>
      </button>
      <button
        onClick={redo}
        disabled={!canRedo}
        title="Redo (Ctrl+Y)"
        className={canRedo ? 'sv-btn-ghost' : 'sv-btn-ghost opacity-30 cursor-not-allowed'}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M21 10H11a5 5 0 00-5 5v0a5 5 0 005 5h4M21 10l-4-4m4 4l-4 4" />
        </svg>
        <span>Redo</span>
      </button>
    </div>
  );
};
