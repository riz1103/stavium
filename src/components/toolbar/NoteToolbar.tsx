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

const DOTABLE = new Set<NoteDuration>(['whole', 'half', 'quarter', 'eighth', 'sixteenth', 'thirty-second']);
const TUPLETABLE = new Set<NoteDuration>(['half', 'quarter', 'eighth', 'sixteenth', 'thirty-second']);
const toDotted = (base: NoteDuration): NoteDuration => `dotted-${base}` as NoteDuration;
type TupletKind = 'straight' | 'triplet' | 'quintuplet' | 'sextuplet' | 'septuplet';
const TUPLET_OPTIONS: Array<{ value: TupletKind; label: string; short: string }> = [
  { value: 'straight', label: 'Straight', short: '—' },
  { value: 'triplet', label: 'Triplet (3:2)', short: '3' },
  { value: 'quintuplet', label: 'Quintuplet (5:4)', short: '5' },
  { value: 'sextuplet', label: 'Sextuplet (6:4)', short: '6' },
  { value: 'septuplet', label: 'Septuplet (7:4)', short: '7' },
];
const toTuplet = (kind: Exclude<TupletKind, 'straight'>, base: NoteDuration): NoteDuration =>
  `${kind}-${base}` as NoteDuration;
const toBase = (dur: NoteDuration): NoteDuration =>
  (dur.startsWith('dotted-') || /^(triplet|quintuplet|sextuplet|septuplet)-/.test(dur))
    ? (dur.replace('dotted-', '').replace(/^(triplet|quintuplet|sextuplet|septuplet)-/, '') as NoteDuration)
    : dur;
const isDotted = (dur: NoteDuration) => dur.startsWith('dotted-');
const getTupletKind = (dur: NoteDuration): TupletKind => {
  const m = dur.match(/^(triplet|quintuplet|sextuplet|septuplet)-/);
  return (m?.[1] as TupletKind | undefined) ?? 'straight';
};

export const NoteToolbar = () => {
  const selectedDuration        = useScoreStore((s) => s.selectedDuration);
  const setSelectedDuration     = useScoreStore((s) => s.setSelectedDuration);
  const setSelectedRestDuration = useScoreStore((s) => s.setSelectedRestDuration);
  const selectedRestDuration    = useScoreStore((s) => s.selectedRestDuration);

  const dotActive = isDotted(selectedDuration);
  const tupletKind = getTupletKind(selectedDuration);
  const baseDur   = toBase(selectedDuration);
  const noteMode  = !selectedRestDuration; // note mode is active when no rest selected

  const handleSelectBase = (base: NoteDuration) => {
    setSelectedRestDuration(null);
    if (tupletKind !== 'straight' && TUPLETABLE.has(base)) {
      setSelectedDuration(toTuplet(tupletKind, base));
      return;
    }
    if (dotActive && DOTABLE.has(base)) {
      setSelectedDuration(toDotted(base));
      return;
    }
    setSelectedDuration(base);
  };

  const handleToggleDot = () => {
    setSelectedRestDuration(null);
    if (!DOTABLE.has(baseDur)) return;
    setSelectedDuration(dotActive ? baseDur : toDotted(baseDur));
  };

  const handleTupletChange = (kind: TupletKind) => {
    setSelectedRestDuration(null);
    if (kind === 'straight') {
      setSelectedDuration(baseDur);
      return;
    }
    if (!TUPLETABLE.has(baseDur)) return;
    setSelectedDuration(toTuplet(kind, baseDur));
  };

  const dotSupported = DOTABLE.has(baseDur);
  const tupletSupported = TUPLETABLE.has(baseDur);

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
        title={!dotSupported ? 'This duration cannot be dotted' : dotActive ? 'Remove dot' : 'Add augmentation dot (×1.5)'}
        className={dotActive && noteMode ? 'sv-btn-active' : dotSupported ? 'sv-btn-ghost' : 'sv-btn-ghost opacity-30 cursor-not-allowed'}
      >
        <svg viewBox="0 0 10 10" width="8" height="8" aria-hidden>
          <circle cx="5" cy="5" r="4" fill="currentColor" />
        </svg>
        <span>Dot</span>
      </button>

      <div className={`flex items-center gap-1 ${!tupletSupported ? 'opacity-40' : ''}`}>
        <span className="text-xs text-sv-text-dim">Tuplet</span>
        <select
          value={tupletKind}
          disabled={!tupletSupported}
          onChange={(e) => handleTupletChange(e.target.value as TupletKind)}
          className="sv-select w-24 text-xs"
          title="Tuplet ratio"
        >
          {TUPLET_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.short} {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};
