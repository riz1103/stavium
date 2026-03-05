import { useScoreStore } from '../../app/store/scoreStore';
import { Clef } from '../../types/music';

const CLEFS: { value: Clef; label: string; symbol: string }[] = [
  { value: 'treble', label: 'Treble', symbol: '𝄞' },
  { value: 'bass',   label: 'Bass',   symbol: '𝄢' },
  { value: 'alto',   label: 'Alto',   symbol: '𝄡' },
  { value: 'tenor',  label: 'Tenor',  symbol: '𝄡' },
];

export const ClefSelector = () => {
  const composition        = useScoreStore((state) => state.composition);
  const selectedStaffIndex = useScoreStore((state) => state.selectedStaffIndex);
  const setComposition     = useScoreStore((state) => state.setComposition);

  const handleClefChange = (clef: Clef) => {
    if (!composition || selectedStaffIndex === null) return;
    const newStaves = [...composition.staves];
    newStaves[selectedStaffIndex] = { ...newStaves[selectedStaffIndex], clef };
    setComposition({ ...composition, staves: newStaves });
  };

  const currentClef = composition && selectedStaffIndex !== null
    ? composition.staves[selectedStaffIndex]?.clef
    : 'treble';

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Clef</span>
      {CLEFS.map((c) => (
        <button
          key={c.value}
          onClick={() => handleClefChange(c.value)}
          title={c.label}
          className={currentClef === c.value ? 'sv-btn-active' : 'sv-btn-ghost'}
        >
          <span className="text-lg leading-none">{c.symbol}</span>
          <span className="hidden sm:inline text-xs">{c.label}</span>
        </button>
      ))}
    </div>
  );
};
