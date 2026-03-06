import { useScoreStore } from '../../app/store/scoreStore';
import { detectChord } from '../../music/theory/chordDetector';
import { Note } from '../../types/music';
import { applyKeySignature } from '../../utils/noteUtils';

export const ChordDetectionPanel = () => {
  const composition          = useScoreStore((state) => state.composition);
  const selectedMeasureIndex = useScoreStore((state) => state.selectedMeasureIndex ?? 0);
  const selectedStaffIndex   = useScoreStore((state) => state.selectedStaffIndex ?? 0);
  const addChord             = useScoreStore((state) => state.addChord);

  if (!composition) return null;

  const staff  = composition.staves[selectedStaffIndex];
  const measure = staff?.measures[selectedMeasureIndex];
  const voice  = measure?.voices[0];
  const notes  = voice?.notes.filter((n): n is Note => 'pitch' in n) ?? [];

  if (notes.length === 0) {
    return (
      <div className="sv-toolbar">
        <span className="sv-toolbar-label">Detected Chord</span>
        <span className="text-xs text-sv-text-dim italic">No notes</span>
      </div>
    );
  }

  const normalizedNotes = notes.map((note) => ({
    ...note,
    pitch: applyKeySignature(note.pitch, composition.keySignature),
  }));
  const chord = detectChord(normalizedNotes);

  const handleAddDetectedChord = () => {
    if (chord) {
      addChord(selectedStaffIndex, selectedMeasureIndex, {
        symbol: chord.name,
        beat: 0, // Add at start of measure
      });
    }
  };

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Detected Chord</span>
      {chord ? (
        <>
          <span className="px-2 py-0.5 rounded-md bg-sv-cyan/10 border border-sv-cyan/30 text-sv-cyan text-sm font-mono font-semibold">
            {chord.name}
          </span>
          <span className="text-xs text-sv-text-dim">
            {chord.root} · {chord.quality}
          </span>
          <button
            onClick={handleAddDetectedChord}
            className="sv-btn-ghost text-xs"
            title="Add as chord symbol"
          >
            + Add
          </button>
        </>
      ) : (
        <span className="text-xs text-sv-text-dim italic">—</span>
      )}
    </div>
  );
};
