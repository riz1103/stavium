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

export const RestToolbar = () => {
  const selectedRestDuration    = useScoreStore((s) => s.selectedRestDuration);
  const setSelectedRestDuration = useScoreStore((s) => s.setSelectedRestDuration);

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Rest</span>
      {durations.map((d) => {
        const active = selectedRestDuration === d.value;
        return (
          <button
            key={d.value}
            onClick={() => setSelectedRestDuration(active ? null : d.value)}
            title={`${d.label} rest — click score to place`}
            className={active ? 'sv-btn-active' : 'sv-btn-ghost'}
          >
            <span className="text-base leading-none">{d.symbol}</span>
            <span className="hidden sm:inline text-xs">{d.label}</span>
          </button>
        );
      })}
    </div>
  );
};
