import { useEffect, useMemo, useState } from 'react';
import { useScoreStore } from '../../app/store/scoreStore';
import { HairpinDirection, Note } from '../../types/music';

type NoteRef = { staffIndex: number; measureIndex: number; voiceIndex: number; noteIndex: number };

const sameNoteRef = (a: NoteRef, b: NoteRef): boolean =>
  a.staffIndex === b.staffIndex &&
  a.measureIndex === b.measureIndex &&
  a.voiceIndex === b.voiceIndex &&
  a.noteIndex === b.noteIndex;

export const HairpinToolbar = () => {
  const selectedNote = useScoreStore((state) => state.selectedNote);
  const composition = useScoreStore((state) => state.composition);
  const updateNote = useScoreStore((state) => state.updateNote);
  const [guidedSpan, setGuidedSpan] = useState<{ direction: HairpinDirection; start: NoteRef } | null>(null);

  if (!selectedNote || !composition) return null;

  const { staffIndex, measureIndex, voiceIndex, noteIndex } = selectedNote;
  const note = composition.staves[staffIndex]?.measures[measureIndex]?.voices[voiceIndex]?.notes[noteIndex];
  if (!note || !('pitch' in note)) return null;
  const currentNote = note as Note;

  const setStart = (direction: HairpinDirection) =>
    updateNote(staffIndex, measureIndex, voiceIndex, noteIndex, { hairpinStart: direction });

  const setEnd = () =>
    updateNote(staffIndex, measureIndex, voiceIndex, noteIndex, { hairpinEnd: true });

  const clearHairpin = () =>
    updateNote(staffIndex, measureIndex, voiceIndex, noteIndex, { hairpinStart: undefined, hairpinEnd: undefined });

  const beginGuidedSpan = (direction: HairpinDirection) => {
    setGuidedSpan({
      direction,
      start: { staffIndex, measureIndex, voiceIndex, noteIndex },
    });
  };

  const sameAsStart = useMemo(() => {
    if (!guidedSpan) return false;
    return (
      guidedSpan.start.staffIndex === staffIndex &&
      guidedSpan.start.measureIndex === measureIndex &&
      guidedSpan.start.voiceIndex === voiceIndex &&
      guidedSpan.start.noteIndex === noteIndex
    );
  }, [guidedSpan, staffIndex, measureIndex, voiceIndex, noteIndex]);

  const finishGuidedSpan = () => {
    if (!guidedSpan) return;
    const s = guidedSpan.start;
    updateNote(s.staffIndex, s.measureIndex, s.voiceIndex, s.noteIndex, {
      hairpinStart: guidedSpan.direction,
      hairpinEnd: undefined,
    });
    if (!sameAsStart) {
      updateNote(staffIndex, measureIndex, voiceIndex, noteIndex, { hairpinEnd: true });
    }
    setGuidedSpan(null);
  };

  // Smooth guided mode: as soon as the user selects a different note,
  // auto-complete the span without requiring an extra button click.
  useEffect(() => {
    if (!guidedSpan) return;
    const current: NoteRef = { staffIndex, measureIndex, voiceIndex, noteIndex };
    if (sameNoteRef(guidedSpan.start, current)) return;
    const s = guidedSpan.start;
    updateNote(s.staffIndex, s.measureIndex, s.voiceIndex, s.noteIndex, {
      hairpinStart: guidedSpan.direction,
      hairpinEnd: undefined,
    });
    updateNote(current.staffIndex, current.measureIndex, current.voiceIndex, current.noteIndex, {
      hairpinEnd: true,
    });
    setGuidedSpan(null);
  }, [guidedSpan, staffIndex, measureIndex, voiceIndex, noteIndex, updateNote]);

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Hairpin</span>
      <button
        onClick={() => setStart('crescendo')}
        title="Start crescendo hairpin (<)"
        className={currentNote.hairpinStart === 'crescendo' ? 'sv-btn-active' : 'sv-btn-ghost'}
      >
        <span className="font-bold text-base leading-none">&lt;</span>
      </button>
      <button
        onClick={() => setStart('decrescendo')}
        title="Start decrescendo hairpin (>)"
        className={currentNote.hairpinStart === 'decrescendo' ? 'sv-btn-active' : 'sv-btn-ghost'}
      >
        <span className="font-bold text-base leading-none">&gt;</span>
      </button>
      <button
        onClick={setEnd}
        title="End active hairpin at this note"
        className={currentNote.hairpinEnd ? 'sv-btn-active' : 'sv-btn-ghost'}
      >
        <span className="text-xs font-medium">End</span>
      </button>
      <button
        onClick={clearHairpin}
        title="Clear hairpin markers on this note"
        className="sv-btn-ghost"
      >
        <span className="text-xs font-medium">Clear</span>
      </button>
      <span className="w-px self-stretch bg-sv-border mx-0.5" />
      {!guidedSpan ? (
        <>
          <button
            onClick={() => beginGuidedSpan('crescendo')}
            title="Guided mode: set start now, then choose end note"
            className="sv-btn-ghost"
          >
            <span className="text-xs font-medium">Create &lt; Span</span>
          </button>
          <button
            onClick={() => beginGuidedSpan('decrescendo')}
            title="Guided mode: set start now, then choose end note"
            className="sv-btn-ghost"
          >
            <span className="text-xs font-medium">Create &gt; Span</span>
          </button>
        </>
      ) : (
        <>
          <button
            onClick={finishGuidedSpan}
            title={sameAsStart ? 'Finish at selected note (same as start)' : 'Finish guided hairpin at selected note'}
            className="sv-btn-active"
          >
            <span className="text-xs font-medium">Finish Span</span>
          </button>
          <button
            onClick={() => setGuidedSpan(null)}
            title="Cancel guided span mode"
            className="sv-btn-ghost"
          >
            <span className="text-xs font-medium">Cancel</span>
          </button>
          <span className="text-[11px] text-sv-text-dim">
            Select end note, then Finish
          </span>
        </>
      )}
    </div>
  );
};
