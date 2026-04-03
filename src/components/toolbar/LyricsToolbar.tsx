import { useEffect, useMemo, useState } from 'react';
import { useScoreStore } from '../../app/store/scoreStore';
import type { Note } from '../../types/music';

export const LyricsToolbar = () => {
  const selectedNote = useScoreStore((state) => state.selectedNote);
  const composition = useScoreStore((state) => state.composition);
  const updateNote = useScoreStore((state) => state.updateNote);
  const setSelectedNote = useScoreStore((state) => state.setSelectedNote);
  const setSelectedMeasureIndex = useScoreStore((state) => state.setSelectedMeasureIndex);
  const setSelectedStaffIndex = useScoreStore((state) => state.setSelectedStaffIndex);
  const replicateLyricsToStaff = useScoreStore((state) => state.replicateLyricsToStaff);
  const [draftLyric, setDraftLyric] = useState('');
  const [targetStaffIndex, setTargetStaffIndex] = useState<number | null>(null);

  const selected = useMemo(() => {
    if (!selectedNote || !composition) return null;
    const { staffIndex, measureIndex, voiceIndex, noteIndex } = selectedNote;
    const note = composition.staves[staffIndex]?.measures[measureIndex]?.voices[voiceIndex]?.notes[noteIndex];
    if (!note || !('pitch' in note)) return null;
    return { ...selectedNote, note: note as Note };
  }, [selectedNote, composition]);

  useEffect(() => {
    setDraftLyric(selected?.note.lyric ?? '');
  }, [selected?.staffIndex, selected?.measureIndex, selected?.voiceIndex, selected?.noteIndex, selected?.note.lyric]);

  useEffect(() => {
    if (!selected || !composition) {
      setTargetStaffIndex(null);
      return;
    }
    const firstOther = composition.staves.findIndex((_, i) => i !== selected.staffIndex);
    setTargetStaffIndex(firstOther >= 0 ? firstOther : null);
  }, [selected?.staffIndex, composition?.staves.length]);

  if (!selected) return null;

  const { staffIndex, measureIndex, voiceIndex, noteIndex, note } = selected;
  const staves = composition?.staves ?? [];

  const commitLyric = () => {
    const normalized = draftLyric.trim();
    const nextLyric = normalized.length > 0 ? normalized : undefined;
    if ((note.lyric ?? undefined) === nextLyric) return;
    updateNote(staffIndex, measureIndex, voiceIndex, noteIndex, { lyric: nextLyric });
  };

  const clearLyric = () => {
    setDraftLyric('');
    if (note.lyric) {
      updateNote(staffIndex, measureIndex, voiceIndex, noteIndex, { lyric: undefined });
    }
  };

  const moveToNextNote = () => {
    if (!composition) return;
    const staff = composition.staves[staffIndex];
    if (!staff) return;

    for (let mi = measureIndex; mi < staff.measures.length; mi++) {
      const voice = staff.measures[mi]?.voices[voiceIndex];
      if (!voice) continue;
      const startIndex = mi === measureIndex ? noteIndex + 1 : 0;
      for (let ni = startIndex; ni < voice.notes.length; ni++) {
        const candidate = voice.notes[ni];
        if (!candidate || !('pitch' in candidate)) continue;
        setSelectedStaffIndex(staffIndex);
        setSelectedMeasureIndex(mi);
        setSelectedNote({
          staffIndex,
          measureIndex: mi,
          voiceIndex,
          noteIndex: ni,
        });
        return;
      }
    }
  };

  const handleReplicate = () => {
    if (targetStaffIndex === null) return;
    commitLyric();
    replicateLyricsToStaff(staffIndex, targetStaffIndex);
  };

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Lyrics</span>
      <input
        type="text"
        value={draftLyric}
        onChange={(e) => setDraftLyric(e.target.value)}
        onBlur={commitLyric}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.code === 'NumpadEnter') {
            e.preventDefault();
            commitLyric();
            moveToNextNote();
          }
        }}
        className="sv-input lyrics-lyric-input"
        placeholder="Syllable"
        title="Lyric text for this note"
      />
      <button
        onClick={commitLyric}
        className="sv-btn-ghost"
        title="Apply lyric text"
      >
        Apply
      </button>
      <button
        onClick={clearLyric}
        className={note.lyric ? 'sv-btn-active' : 'sv-btn-ghost'}
        title="Clear lyric from this note"
      >
        Clear
      </button>
      {staves.length > 1 && (
        <>
          <select
            className="sv-select"
            value={targetStaffIndex ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              setTargetStaffIndex(value === '' ? null : Number(value));
            }}
            title="Target staff to replicate lyrics to"
          >
            {staves
              .map((staff, idx) => ({ staff, idx }))
              .filter(({ idx }) => idx !== staffIndex)
              .map(({ staff, idx }) => (
                <option key={idx} value={idx}>
                  {staff.name?.trim() || `Staff ${idx + 1}`}
                </option>
              ))}
          </select>
          <button
            onClick={handleReplicate}
            disabled={targetStaffIndex === null}
            className={targetStaffIndex === null ? 'sv-btn-ghost opacity-40 cursor-not-allowed' : 'sv-btn-ghost'}
            title="Replicate all lyrics from this staff to selected staff"
          >
            Replicate Staff Lyrics
          </button>
        </>
      )}
    </div>
  );
};
