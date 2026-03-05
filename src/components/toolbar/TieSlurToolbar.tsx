import { useScoreStore } from '../../app/store/scoreStore';

export const TieSlurToolbar = () => {
  const selectedNote = useScoreStore((state) => state.selectedNote);
  const composition  = useScoreStore((state) => state.composition);
  const updateNote   = useScoreStore((state) => state.updateNote);

  if (!selectedNote || !composition) return null;

  const { staffIndex, measureIndex, voiceIndex, noteIndex } = selectedNote;
  const voice = composition.staves[staffIndex]?.measures[measureIndex]?.voices[voiceIndex];
  const note  = voice?.notes[noteIndex];
  if (!note || !('pitch' in note)) return null;

  const currentNote = note as import('../../types/music').Note;
  const nextNote    = noteIndex < (voice?.notes.length ?? 0) - 1 ? voice!.notes[noteIndex + 1] : null;
  if (!nextNote || !('pitch' in nextNote)) return null;

  const wouldBeTie  = (nextNote as import('../../types/music').Note).pitch === currentNote.pitch;
  const isConnected = currentNote.tie || currentNote.slur;
  const label       = wouldBeTie ? 'Tie' : 'Slur';

  const toggle = () => {
    if (isConnected) {
      updateNote(staffIndex, measureIndex, voiceIndex, noteIndex, { tie: false, slur: false });
    } else if (wouldBeTie) {
      updateNote(staffIndex, measureIndex, voiceIndex, noteIndex, { tie: true, slur: false });
    } else {
      updateNote(staffIndex, measureIndex, voiceIndex, noteIndex, { tie: false, slur: true });
    }
  };

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Connect</span>
      <button
        onClick={toggle}
        title={isConnected ? `Remove ${label}` : `Add ${label} to next note`}
        className={isConnected ? 'sv-btn-active' : 'sv-btn-ghost'}
      >
        <span className="text-base">⌢</span>
        <span>{isConnected ? (wouldBeTie ? 'Tied' : 'Slurred') : label}</span>
      </button>
    </div>
  );
};
