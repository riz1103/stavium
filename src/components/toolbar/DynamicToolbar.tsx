import { useScoreStore } from '../../app/store/scoreStore';

const DYNAMICS = [
  { value: null,  label: '—'   },
  { value: 'ppp', label: 'ppp' },
  { value: 'pp',  label: 'pp'  },
  { value: 'p',   label: 'p'   },
  { value: 'mp',  label: 'mp'  },
  { value: 'mf',  label: 'mf'  },
  { value: 'f',   label: 'f'   },
  { value: 'ff',  label: 'ff'  },
  { value: 'fff', label: 'fff' },
] as const;

const NAMES: Record<string, string> = {
  ppp: 'Pianississimo', pp: 'Pianissimo', p: 'Piano', mp: 'Mezzo Piano',
  mf: 'Mezzo Forte', f: 'Forte', ff: 'Fortissimo', fff: 'Fortississimo',
};

export const DynamicToolbar = () => {
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
      <span className="sv-toolbar-label">Dynamic</span>
      {DYNAMICS.map((d) => {
        const active = d.value === null ? !currentNote.dynamic : currentNote.dynamic === d.value;
        return (
          <button
            key={d.label}
            onClick={() => updateNote(staffIndex, measureIndex, voiceIndex, noteIndex, { dynamic: d.value ?? undefined })}
            title={d.value ? NAMES[d.value] : 'No dynamic'}
            className={active ? 'sv-btn-active' : 'sv-btn-ghost'}
          >
            <span className="font-bold italic text-base leading-none">{d.label}</span>
          </button>
        );
      })}
    </div>
  );
};
