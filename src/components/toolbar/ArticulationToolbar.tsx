import { useScoreStore } from '../../app/store/scoreStore';

const ARTICULATIONS = [
  { value: null,  label: 'None',             symbol: '—'  },
  { value: 'a.',  label: 'Staccato',         symbol: '•'  },
  { value: 'av',  label: 'Staccatissimo',    symbol: '▼'  },
  { value: '>',   label: 'Accent',           symbol: '>'  },
  { value: '-',   label: 'Tenuto',           symbol: '—'  },
  { value: '^',   label: 'Marcato',          symbol: '^'  },
  { value: 'a>',  label: 'Marcato-Staccato', symbol: '^•' },
] as const;

export const ArticulationToolbar = () => {
  const selectedNote = useScoreStore((state) => state.selectedNote);
  const composition  = useScoreStore((state) => state.composition);
  const updateNote   = useScoreStore((state) => state.updateNote);

  if (!selectedNote || !composition) return null;

  const { staffIndex, measureIndex, voiceIndex, noteIndex } = selectedNote;
  const note = composition.staves[staffIndex]?.measures[measureIndex]?.voices[voiceIndex]?.notes[noteIndex];
  if (!note || !('pitch' in note)) return null;

  const currentNote = note as import('../../types/music').Note;

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Articulation</span>
      {ARTICULATIONS.map((a) => {
        const active = a.value === null ? !currentNote.articulation : currentNote.articulation === a.value;
        return (
          <button
            key={a.label}
            onClick={() => updateNote(staffIndex, measureIndex, voiceIndex, noteIndex, { articulation: a.value ?? undefined })}
            title={a.label}
            className={active ? 'sv-btn-active' : 'sv-btn-ghost'}
          >
            <span className="font-bold leading-none">{a.symbol}</span>
            <span className="hidden sm:inline text-xs">{a.label}</span>
          </button>
        );
      })}
    </div>
  );
};
