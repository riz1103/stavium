import { useScoreStore } from '../../app/store/scoreStore';
import { Instrument } from '../../types/music';

const INSTRUMENTS: Instrument[] = ['piano', 'organ', 'guitar', 'violin', 'strings', 'choir', 'brass', 'synth', 'flute'];

export const InstrumentSelector = () => {
  const composition        = useScoreStore((state) => state.composition);
  const selectedStaffIndex = useScoreStore((state) => state.selectedStaffIndex);
  const setComposition     = useScoreStore((state) => state.setComposition);

  const handleChange = (instrument: Instrument) => {
    if (!composition || selectedStaffIndex === null) return;
    const newStaves = [...composition.staves];
    newStaves[selectedStaffIndex] = { ...newStaves[selectedStaffIndex], instrument };
    setComposition({ ...composition, staves: newStaves });
  };

  const current = composition && selectedStaffIndex !== null
    ? composition.staves[selectedStaffIndex]?.instrument
    : 'piano';

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Instrument</span>
      <select
        value={current}
        onChange={(e) => handleChange(e.target.value as Instrument)}
        className="sv-select min-w-[110px]"
      >
        {INSTRUMENTS.map((i) => (
          <option key={i} value={i}>
            {i.charAt(0).toUpperCase() + i.slice(1)}
          </option>
        ))}
      </select>
    </div>
  );
};
