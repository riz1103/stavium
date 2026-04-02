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

const TUPLETABLE = new Set<NoteDuration>(['half', 'quarter', 'eighth', 'sixteenth', 'thirty-second']);
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
  /^(triplet|quintuplet|sextuplet|septuplet)-/.test(dur)
    ? (dur.replace(/^(triplet|quintuplet|sextuplet|septuplet)-/, '') as NoteDuration)
    : dur;
const getTupletKind = (dur: NoteDuration | null): TupletKind => {
  if (!dur) return 'straight';
  const m = dur.match(/^(triplet|quintuplet|sextuplet|septuplet)-/);
  return (m?.[1] as TupletKind | undefined) ?? 'straight';
};

export const RestToolbar = () => {
  const selectedRestDuration    = useScoreStore((s) => s.selectedRestDuration);
  const setSelectedRestDuration = useScoreStore((s) => s.setSelectedRestDuration);
  const baseDur = toBase(selectedRestDuration ?? 'quarter');
  const tupletKind = getTupletKind(selectedRestDuration);
  const tupletSupported = TUPLETABLE.has(baseDur);

  const handleTupletChange = (kind: TupletKind) => {
    if (!selectedRestDuration || !tupletSupported) return;
    setSelectedRestDuration(kind === 'straight' ? baseDur : toTuplet(kind, baseDur));
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
              const next = tupletKind !== 'straight' && TUPLETABLE.has(d.value)
                ? toTuplet(tupletKind, d.value)
                : d.value;
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
      <div className={`flex items-center gap-1 ${(!selectedRestDuration || !tupletSupported) ? 'opacity-40' : ''}`}>
        <span className="text-xs text-sv-text-dim">Tuplet</span>
        <select
          value={tupletKind}
          disabled={!selectedRestDuration || !tupletSupported}
          onChange={(e) => handleTupletChange(e.target.value as TupletKind)}
          className="sv-select w-24 text-xs"
          title="Tuplet ratio for rests"
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
