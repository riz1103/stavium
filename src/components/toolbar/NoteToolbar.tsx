import { useScoreStore } from '../../app/store/scoreStore';
import { NoteDuration } from '../../types/music';
import { NoteIcon } from './NoteIcon';

const BASE_DURATIONS: { value: NoteDuration; label: string }[] = [
  { value: 'whole',         label: 'Whole'     },
  { value: 'half',          label: 'Half'      },
  { value: 'quarter',       label: 'Quarter'   },
  { value: 'eighth',        label: '8th'       },
  { value: 'sixteenth',     label: '16th'      },
  { value: 'thirty-second', label: '32nd'      },
];

const DOTABLE = new Set<NoteDuration>(['whole', 'half', 'quarter', 'eighth', 'sixteenth']);
const toDotted = (base: NoteDuration): NoteDuration => `dotted-${base}` as NoteDuration;
const toBase   = (dur: NoteDuration): NoteDuration  => dur.startsWith('dotted-') ? (dur.replace('dotted-', '') as NoteDuration) : dur;
const isDotted = (dur: NoteDuration) => dur.startsWith('dotted-');

export const NoteToolbar = () => {
  const selectedDuration        = useScoreStore((s) => s.selectedDuration);
  const setSelectedDuration     = useScoreStore((s) => s.setSelectedDuration);
  const setSelectedRestDuration = useScoreStore((s) => s.setSelectedRestDuration);
  const selectedRestDuration    = useScoreStore((s) => s.selectedRestDuration);

  const dotActive = isDotted(selectedDuration);
  const baseDur   = toBase(selectedDuration);
  const noteMode  = !selectedRestDuration; // note mode is active when no rest selected

  const handleSelectBase = (base: NoteDuration) => {
    setSelectedRestDuration(null);
    setSelectedDuration(dotActive && DOTABLE.has(base) ? toDotted(base) : base);
  };

  const handleToggleDot = () => {
    setSelectedRestDuration(null);
    if (dotActive) {
      setSelectedDuration(baseDur);
    } else if (DOTABLE.has(baseDur)) {
      setSelectedDuration(toDotted(baseDur));
    }
  };

  const dotSupported = DOTABLE.has(baseDur);

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Note</span>

      {BASE_DURATIONS.map((d) => {
        const active = noteMode && baseDur === d.value;
        return (
          <button
            key={d.value}
            onClick={() => handleSelectBase(d.value)}
            title={d.label}
            className={active ? 'sv-btn-active' : 'sv-btn-ghost'}
          >
            <span className="flex-shrink-0 w-4 h-5 flex items-center justify-center">
              <NoteIcon duration={d.value} />
            </span>
            <span className="hidden sm:inline">{d.label}</span>
          </button>
        );
      })}

      <div className="w-px self-stretch bg-sv-border mx-0.5" />

      {/* Dot toggle */}
      <button
        onClick={handleToggleDot}
        disabled={!dotSupported}
        title={!dotSupported ? '32nd cannot be dotted' : dotActive ? 'Remove dot' : 'Add augmentation dot (×1.5)'}
        className={dotActive && noteMode ? 'sv-btn-active' : dotSupported ? 'sv-btn-ghost' : 'sv-btn-ghost opacity-30 cursor-not-allowed'}
      >
        <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden>
          <circle cx="5" cy="5" r="4" fill="currentColor" />
        </svg>
        <span>Dot</span>
      </button>
    </div>
  );
};
