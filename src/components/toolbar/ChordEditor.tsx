import { useState } from 'react';
import { useScoreStore } from '../../app/store/scoreStore';
import { ChordSymbol } from '../../types/music';
import { durationToBeats } from '../../utils/durationUtils';

export const ChordEditor = () => {
  const composition = useScoreStore((state) => state.composition);
  const selectedMeasureIndex = useScoreStore((state) => state.selectedMeasureIndex ?? 0);
  const selectedStaffIndex = useScoreStore((state) => state.selectedStaffIndex ?? 0);
  const addChord = useScoreStore((state) => state.addChord);
  const removeChord = useScoreStore((state) => state.removeChord);
  const updateChord = useScoreStore((state) => state.updateChord);

  const [newChordSymbol, setNewChordSymbol] = useState('');
  const [newChordBeat, setNewChordBeat] = useState(0);

  if (!composition) return null;

  const staff = composition.staves[selectedStaffIndex];
  const measure = staff?.measures[selectedMeasureIndex];
  const chords = measure?.chords || [];

  // Calculate beats per measure
  const timeSig = measure?.timeSignature || composition.timeSignature;
  const [numerator] = timeSig.split('/').map(Number);
  const beatsPerMeasure = numerator || 4;

  const handleAddChord = () => {
    if (!newChordSymbol.trim()) return;
    
    const beat = Math.max(0, Math.min(beatsPerMeasure - 0.25, newChordBeat));
    addChord(selectedStaffIndex, selectedMeasureIndex, {
      symbol: newChordSymbol.trim(),
      beat,
    });
    
    setNewChordSymbol('');
    setNewChordBeat(0);
  };

  const handleRemoveChord = (index: number) => {
    removeChord(selectedStaffIndex, selectedMeasureIndex, index);
  };

  const handleUpdateChordSymbol = (index: number, symbol: string) => {
    updateChord(selectedStaffIndex, selectedMeasureIndex, index, { symbol });
  };

  const handleUpdateChordBeat = (index: number, beat: number) => {
    const clampedBeat = Math.max(0, Math.min(beatsPerMeasure - 0.25, beat));
    updateChord(selectedStaffIndex, selectedMeasureIndex, index, { beat: clampedBeat });
  };

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Chords</span>
      
      {/* Add new chord */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newChordSymbol}
          onChange={(e) => setNewChordSymbol(e.target.value)}
          placeholder="e.g., Cm7, F/A"
          className="px-2 py-1 bg-sv-elevated border border-sv-border rounded text-sm text-sv-text placeholder-sv-text-dim focus:outline-none focus:border-sv-cyan/60"
          style={{ width: '80px' }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              handleAddChord();
            }
          }}
        />
        <input
          type="number"
          value={newChordBeat}
          onChange={(e) => setNewChordBeat(Number(e.target.value))}
          min={0}
          max={beatsPerMeasure - 0.25}
          step={0.25}
          placeholder="Beat"
          className="px-2 py-1 bg-sv-elevated border border-sv-border rounded text-sm text-sv-text w-16 focus:outline-none focus:border-sv-cyan/60"
        />
        <button
          onClick={handleAddChord}
          className="sv-btn-active"
          disabled={!newChordSymbol.trim()}
        >
          Add
        </button>
      </div>

      {/* Existing chords */}
      {chords.length > 0 && (
        <div className="flex flex-col gap-1 mt-2">
          {chords.map((chord, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="text"
                value={chord.symbol}
                onChange={(e) => handleUpdateChordSymbol(index, e.target.value)}
                className="px-2 py-1 bg-sv-elevated border border-sv-border rounded text-sm text-sv-text focus:outline-none focus:border-sv-cyan/60"
                style={{ width: '80px' }}
              />
              <input
                type="number"
                value={chord.beat}
                onChange={(e) => handleUpdateChordBeat(index, Number(e.target.value))}
                min={0}
                max={beatsPerMeasure - 0.25}
                step={0.25}
                className="px-2 py-1 bg-sv-elevated border border-sv-border rounded text-sm text-sv-text w-16 focus:outline-none focus:border-sv-cyan/60"
              />
              <button
                onClick={() => handleRemoveChord(index)}
                className="sv-btn-ghost text-xs"
                title="Remove chord"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {chords.length === 0 && (
        <span className="text-xs text-sv-text-dim italic">No chords</span>
      )}
    </div>
  );
};
