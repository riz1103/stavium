import { useScoreStore } from '../../app/store/scoreStore';
import type { Note, SlurDirection } from '../../types/music';

/** Small icon labels for each direction option */
const DIR_OPTIONS: { value: SlurDirection; label: string; title: string }[] = [
  { value: 'above', label: '⌢↑', title: 'Curve above the notes' },
  { value: 'auto',  label: '⌢ Auto', title: 'Automatic direction (based on stem direction)' },
  { value: 'below', label: '⌢↓', title: 'Curve below the notes' },
];

export const TieSlurToolbar = () => {
  const selectedNote         = useScoreStore((state) => state.selectedNote);
  const composition          = useScoreStore((state) => state.composition);
  const updateNote           = useScoreStore((state) => state.updateNote);
  const setChainSlurDirection = useScoreStore((state) => state.setChainSlurDirection);

  if (!selectedNote || !composition) return null;

  const { staffIndex, measureIndex, voiceIndex, noteIndex } = selectedNote;
  const voice = composition.staves[staffIndex]?.measures[measureIndex]?.voices[voiceIndex];
  const note  = voice?.notes[noteIndex];
  if (!note || !('pitch' in note)) return null;

  const currentNote = note as Note;

  // Look for the next note within the same measure first; if this is the last
  // note in the measure, cross the barline and look at the first note of the
  // next measure (ties and slurs can and do cross barlines in standard notation).
  const isLastInMeasure = noteIndex >= (voice?.notes.length ?? 0) - 1;
  let nextNote: import('../../types/music').MusicElement | null = null;
  if (!isLastInMeasure) {
    nextNote = voice!.notes[noteIndex + 1];
  } else {
    const nextVoice = composition.staves[staffIndex]?.measures[measureIndex + 1]?.voices[voiceIndex];
    nextNote = nextVoice?.notes.find(el => 'pitch' in el) ?? null;
  }
  if (!nextNote || !('pitch' in nextNote)) return null;

  const wouldBeTie  = (nextNote as Note).pitch === currentNote.pitch;
  const isConnected = currentNote.tie || currentNote.slur;
  const label       = wouldBeTie ? 'Tie' : 'Slur';

  // Show the direction that actually controls the active arc:
  //   tie context  → tieDirection (completely independent of slurDirection)
  //   slur context → slurDirection
  const currentDir: SlurDirection = wouldBeTie
    ? (currentNote.tieDirection ?? 'auto')
    : (currentNote.slurDirection ?? 'auto');

  const toggle = () => {
    if (isConnected) {
      updateNote(staffIndex, measureIndex, voiceIndex, noteIndex,
        { tie: false, slur: false, slurDirection: undefined });
    } else if (wouldBeTie) {
      updateNote(staffIndex, measureIndex, voiceIndex, noteIndex,
        { tie: true, slur: false });
    } else {
      updateNote(staffIndex, measureIndex, voiceIndex, noteIndex,
        { tie: false, slur: true });
    }
  };

  const applyDirection = (dir: SlurDirection) => {
    // Pass wouldBeTie so the store knows whether to update just this note's tie
    // arc (isTieContext=true) or the entire slur chain (isTieContext=false).
    setChainSlurDirection(staffIndex, measureIndex, voiceIndex, noteIndex, dir, wouldBeTie);
  };

  return (
    <div className="sv-toolbar" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
      {/* ── Connect toggle ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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

      {/* ── Direction picker (only visible when a tie/slur is active) ── */}
      {isConnected && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span
            style={{
              fontSize: '10px',
              color: '#94a3b8',
              fontWeight: 500,
              marginRight: '2px',
              whiteSpace: 'nowrap',
            }}
          >
            Direction
          </span>
          {DIR_OPTIONS.map(({ value, label: lbl, title }) => (
            <button
              key={value}
              onClick={() => applyDirection(value)}
              title={title}
              className={currentDir === value ? 'sv-btn-active' : 'sv-btn-ghost'}
              style={{ fontSize: '11px', padding: '2px 6px' }}
            >
              {lbl}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
