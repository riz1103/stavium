import { useScoreStore } from '../../app/store/scoreStore';
import { usePlaybackStore } from '../../app/store/playbackStore';
import { Instrument } from '../../types/music';

const INSTRUMENTS: Instrument[] = ['piano', 'organ', 'guitar', 'violin', 'strings', 'choir', 'brass', 'synth', 'flute'];

interface InstrumentSelectorProps {
  isReadOnly?: boolean;
}

export const InstrumentSelector = ({ isReadOnly = false }: InstrumentSelectorProps) => {
  const composition        = useScoreStore((state) => state.composition);
  const selectedStaffIndex = useScoreStore((state) => state.selectedStaffIndex);
  const setComposition     = useScoreStore((state) => state.setComposition);
  
  // Playback instruments for view-only users
  const playbackInstruments = usePlaybackStore((state) => state.playbackInstruments);
  const setPlaybackInstrument = usePlaybackStore((state) => state.setPlaybackInstrument);
  const getEffectiveInstrument = usePlaybackStore((state) => state.getEffectiveInstrument);

  const handleChange = (instrument: Instrument) => {
    if (!composition) return;
    
    if (isReadOnly) {
      // For view-only users, update playback instrument for ALL staves (for playback/study)
      composition.staves.forEach((_, staffIndex) => {
        setPlaybackInstrument(staffIndex, instrument);
      });
    } else {
      // For editors, update the composition instrument for the selected staff only
      if (selectedStaffIndex === null) return;
      const newStaves = [...composition.staves];
      newStaves[selectedStaffIndex] = { ...newStaves[selectedStaffIndex], instrument };
      setComposition({ ...composition, staves: newStaves });
    }
  };

  // For view-only mode, show the effective instrument of the first staff
  // (since we set all staves to the same instrument when changed)
  // For edit mode, show the selected staff's instrument
  let displayInstrument: string = 'piano';
  if (isReadOnly && composition && composition.staves.length > 0) {
    const firstStaffInstrument = composition.staves[0]?.instrument ?? 'piano';
    displayInstrument = getEffectiveInstrument(0, firstStaffInstrument);
  } else if (composition && selectedStaffIndex !== null) {
    displayInstrument = composition.staves[selectedStaffIndex]?.instrument ?? 'piano';
  }

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Instrument</span>
      <select
        value={displayInstrument}
        onChange={(e) => handleChange(e.target.value as Instrument)}
        className="sv-select min-w-[110px]"
        title={isReadOnly ? "Playback instrument (for study/playback only, doesn't save)" : "Composition instrument"}
      >
        {INSTRUMENTS.map((i) => (
          <option key={i} value={i}>
            {i.charAt(0).toUpperCase() + i.slice(1)}
          </option>
        ))}
      </select>
      {isReadOnly && composition && composition.staves.length > 0 && 
       composition.staves.some((_, index) => playbackInstruments[index]) && (
        <span className="text-xs text-amber-400 ml-1" title="Using playback instrument for all staves">🎵</span>
      )}
    </div>
  );
};
