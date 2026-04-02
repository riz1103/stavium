import { useMemo } from 'react';
import { useScoreStore } from '../../app/store/scoreStore';
import { GregorianChantOrnament, GregorianChantSymbol, Note } from '../../types/music';

const CHANT_SYMBOLS: Array<{ value: GregorianChantSymbol; label: string }> = [
  { value: 'punctum', label: 'Punctum' },
  { value: 'virga', label: 'Virga' },
  { value: 'podatus', label: 'Podatus' },
  { value: 'clivis', label: 'Clivis' },
  { value: 'torculus', label: 'Torculus' },
  { value: 'porrectus', label: 'Porrectus' },
  { value: 'quilisma', label: 'Quilisma' },
  { value: 'liquescent', label: 'Liquescent' },
];

const CHANT_ORNAMENTS: Array<{ value: GregorianChantOrnament; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'episema', label: 'Episema' },
  { value: 'mora', label: 'Mora' },
];

export const GregorianChantToolbar = () => {
  const composition = useScoreStore((s) => s.composition);
  const selectedNote = useScoreStore((s) => s.selectedNote);
  const updateNote = useScoreStore((s) => s.updateNote);

  const selected = useMemo(() => {
    if (!composition || !selectedNote) return null;
    const note = composition.staves[selectedNote.staffIndex]
      ?.measures[selectedNote.measureIndex]
      ?.voices[selectedNote.voiceIndex]
      ?.notes[selectedNote.noteIndex];
    return note && 'pitch' in note ? (note as Note) : null;
  }, [composition, selectedNote]);

  if (!composition || composition.notationSystem !== 'gregorian-chant' || !selectedNote || !selected) {
    return null;
  }

  const symbol = selected.chantSymbol ?? 'punctum';
  const ornament = selected.chantOrnament ?? 'none';

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Chant</span>
      <select
        value={symbol}
        onChange={(e) =>
          updateNote(
            selectedNote.staffIndex,
            selectedNote.measureIndex,
            selectedNote.voiceIndex,
            selectedNote.noteIndex,
            { chantSymbol: e.target.value as GregorianChantSymbol }
          )
        }
        className="sv-select w-32 text-xs"
        title="Gregorian note symbol"
      >
        {CHANT_SYMBOLS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <span className="text-xs text-sv-text-dim">Orn.</span>
      <select
        value={ornament}
        onChange={(e) =>
          updateNote(
            selectedNote.staffIndex,
            selectedNote.measureIndex,
            selectedNote.voiceIndex,
            selectedNote.noteIndex,
            { chantOrnament: e.target.value as GregorianChantOrnament }
          )
        }
        className="sv-select w-24 text-xs"
        title="Gregorian ornament"
      >
        {CHANT_ORNAMENTS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};
