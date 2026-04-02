import { useScoreStore } from '../../app/store/scoreStore';
import { NoteDuration } from '../../types/music';

const durations: { value: NoteDuration; label: string; symbol: string }[] = [
  { value: 'whole',         label: 'Whole', symbol: '𝄻' },
  { value: 'half',          label: 'Half',  symbol: '𝄼' },
  { value: 'quarter',       label: '¼',     symbol: '𝄽' },
  { value: 'eighth',        label: '⅛',     symbol: '𝄾' },
  { value: 'sixteenth',     label: '16th',  symbol: '𝄿' },
  { value: 'thirty-second', label: '32nd',  symbol: '𝅀' },
];

const TRIPLETABLE = new Set<NoteDuration>(['half', 'quarter', 'eighth', 'sixteenth', 'thirty-second']);
const toTriplet = (base: NoteDuration): NoteDuration => `triplet-${base}` as NoteDuration;
const toBase = (dur: NoteDuration): NoteDuration =>
  dur.startsWith('triplet-') ? (dur.replace('triplet-', '') as NoteDuration) : dur;
const isTriplet = (dur: NoteDuration | null): boolean => !!dur && dur.startsWith('triplet-');

export const RestToolbar = () => {
  const selectedRestDuration    = useScoreStore((s) => s.selectedRestDuration);
  const setSelectedRestDuration = useScoreStore((s) => s.setSelectedRestDuration);
  const baseDur = toBase(selectedRestDuration ?? 'quarter');
  const tripletActive = isTriplet(selectedRestDuration);
  const tripletSupported = TRIPLETABLE.has(baseDur);

  const toggleTriplet = () => {
    if (!selectedRestDuration || !tripletSupported) return;
    setSelectedRestDuration(tripletActive ? baseDur : toTriplet(baseDur));
  };

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Rest</span>
      {durations.map((d) => {
        const active = selectedRestDuration !== null && toBase(selectedRestDuration) === d.value;
        return (
          <button
            key={d.value}
            onClick={() => {
              const next = tripletActive && TRIPLETABLE.has(d.value) ? toTriplet(d.value) : d.value;
              setSelectedRestDuration(active ? null : next);
            }}
            title={`${d.label} rest — click score to place`}
            className={active ? 'sv-btn-active' : 'sv-btn-ghost'}
          >
            <span className="text-base leading-none">{d.symbol}</span>
            <span className="hidden sm:inline text-xs">{d.label}</span>
          </button>
        );
      })}
      <div className="w-px self-stretch bg-sv-border mx-0.5" />
      <button
        onClick={toggleTriplet}
        disabled={!selectedRestDuration || !tripletSupported}
        title={
          !selectedRestDuration
            ? 'Select a rest duration first'
            : !tripletSupported
            ? 'This duration cannot be tripletized'
            : tripletActive
            ? 'Remove triplet'
            : 'Set to triplet (3 in the time of 2)'
        }
        className={
          tripletActive
            ? 'sv-btn-active'
            : selectedRestDuration && tripletSupported
            ? 'sv-btn-ghost'
            : 'sv-btn-ghost opacity-30 cursor-not-allowed'
        }
      >
        <span className="font-semibold">3</span>
        <span>Triplet</span>
      </button>
    </div>
  );
};
