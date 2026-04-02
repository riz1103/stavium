import { useScoreStore } from '../../app/store/scoreStore';
import { Accidental } from '../../types/music';
import { parsePitch } from '../../utils/noteUtils';

const ACCIDENTALS: { value: Accidental | null; symbol: string; label: string }[] = [
  { value: 'double-sharp', symbol: '𝄪', label: 'Double Sharp'   },
  { value: 'sharp',   symbol: '♯', label: 'Sharp'          },
  { value: 'double-flat',  symbol: '𝄫', label: 'Double Flat'    },
  { value: 'flat',    symbol: '♭', label: 'Flat'           },
  { value: 'natural', symbol: '♮', label: 'Natural'        },
  { value: null,      symbol: '—', label: 'Key Signature'  },
];

export const AccidentalToolbar = () => {
  const selectedNote = useScoreStore((state) => state.selectedNote);
  const composition  = useScoreStore((state) => state.composition);
  const updateNote   = useScoreStore((state) => state.updateNote);

  if (!selectedNote || !composition) return null;

  const { staffIndex, measureIndex, voiceIndex, noteIndex } = selectedNote;
  const note = composition.staves[staffIndex]?.measures[measureIndex]?.voices[voiceIndex]?.notes[noteIndex];
  if (!note || !('pitch' in note)) return null;

  const currentNote = note as import('../../types/music').Note;
  const { note: noteName, octave } = parsePitch(currentNote.pitch);

  const applyAccidental = (accidental: Accidental) => {
    let newPitch: string;
    if (accidental === 'double-sharp') newPitch = `${noteName}##${octave}`;
    else if (accidental === 'sharp')   newPitch = `${noteName}#${octave}`;
    else if (accidental === 'double-flat') newPitch = `${noteName}bb${octave}`;
    else if (accidental === 'flat')    newPitch = `${noteName}b${octave}`;
    else if (accidental === 'natural') newPitch = `${noteName}n${octave}`;
    else                               newPitch = `${noteName}${octave}`;
    updateNote(staffIndex, measureIndex, voiceIndex, noteIndex, { pitch: newPitch, accidental });
  };

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Accidental</span>
      {ACCIDENTALS.map((a) => {
        const active = a.value === null ? !currentNote.accidental : currentNote.accidental === a.value;
        return (
          <button
            key={a.label}
            onClick={() => applyAccidental(a.value)}
            title={a.label}
            className={active ? 'sv-btn-active' : 'sv-btn-ghost'}
          >
            <span className="text-base font-bold leading-none">{a.symbol}</span>
            <span className="hidden sm:inline text-xs">{a.label}</span>
          </button>
        );
      })}
    </div>
  );
};
