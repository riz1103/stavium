import { useEffect } from 'react';
import { useScoreStore } from '../../app/store/scoreStore';
import { Clef } from '../../types/music';

const CLEFS: { value: Clef; label: string; symbol: string }[] = [
  { value: 'treble', label: 'Treble', symbol: '𝄞' },
  { value: 'bass',   label: 'Bass',   symbol: '𝄢' },
  { value: 'alto',   label: 'Alto',   symbol: '𝄡' },
  { value: 'tenor',  label: 'Tenor',  symbol: '𝄡' },
];
const GREGORIAN_CLEFS: { value: Clef; label: string; symbol: string }[] = [
  { value: 'alto',  label: 'Do (C) clef', symbol: '𝄡' },
  { value: 'bass',  label: 'Fa (F) clef', symbol: '𝄢' },
];

export const ClefSelector = () => {
  const composition        = useScoreStore((state) => state.composition);
  const selectedStaffIndex = useScoreStore((state) => state.selectedStaffIndex);
  const setComposition     = useScoreStore((state) => state.setComposition);
  const isGregorianChant   = composition?.notationSystem === 'gregorian-chant';

  const handleClefChange = (clef: Clef) => {
    if (!composition || selectedStaffIndex === null) return;
    const newStaves = [...composition.staves];
    newStaves[selectedStaffIndex] = { ...newStaves[selectedStaffIndex], clef };
    setComposition({ ...composition, staves: newStaves });
  };

  const currentClef = composition && selectedStaffIndex !== null
    ? composition.staves[selectedStaffIndex]?.clef
    : 'treble';
  const visibleClefs = isGregorianChant ? GREGORIAN_CLEFS : CLEFS;

  useEffect(() => {
    if (!isGregorianChant || !composition || selectedStaffIndex === null) return;
    const active = composition.staves[selectedStaffIndex]?.clef;
    if (active === 'treble' || active === 'tenor') {
      const newStaves = [...composition.staves];
      newStaves[selectedStaffIndex] = {
        ...newStaves[selectedStaffIndex],
        clef: 'alto',
      };
      setComposition({ ...composition, staves: newStaves });
    }
  }, [isGregorianChant, composition, selectedStaffIndex, setComposition]);

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Clef</span>
      {visibleClefs.map((c) => (
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
