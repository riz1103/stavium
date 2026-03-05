import React from 'react';
import { useScoreStore } from '../../app/store/scoreStore';

export const MeasureControls = () => {
  const composition           = useScoreStore((state) => state.composition);
  const selectedStaffIndex    = useScoreStore((state) => state.selectedStaffIndex ?? 0);
  const selectedMeasureIndex  = useScoreStore((state) => state.selectedMeasureIndex ?? 0);
  const measureSelectionStart = useScoreStore((state) => state.measureSelectionStart);
  const setMeasureIndex       = useScoreStore((state) => state.setSelectedMeasureIndex);
  const setMeasureSelStart    = useScoreStore((state) => state.setMeasureSelectionStart);
  const addMeasure            = useScoreStore((state) => state.addMeasure);
  const removeMeasure         = useScoreStore((state) => state.removeMeasure);
  const copyMeasure           = useScoreStore((state) => state.copyMeasure);
  const pasteMeasure          = useScoreStore((state) => state.pasteMeasure);
  const copiedMeasures        = useScoreStore((state) => state.copiedMeasures);
  const copiedStaffIndex      = useScoreStore((state) => state.copiedStaffIndex);

  if (!composition) return null;

  const measureCount = composition.staves[selectedStaffIndex]?.measures.length || 0;

  const handlePrev = (e?: React.MouseEvent) => {
    if (selectedMeasureIndex <= 0) return;
    const next = selectedMeasureIndex - 1;
    if (e?.shiftKey) {
      if (measureSelectionStart === null) setMeasureSelStart(selectedMeasureIndex);
      setMeasureIndex(next);
    } else {
      setMeasureIndex(next);
      setMeasureSelStart(next);
    }
  };

  const handleNext = (e?: React.MouseEvent) => {
    if (selectedMeasureIndex >= measureCount - 1) return;
    const next = selectedMeasureIndex + 1;
    if (e?.shiftKey) {
      if (measureSelectionStart === null) setMeasureSelStart(selectedMeasureIndex);
      setMeasureIndex(next);
    } else {
      setMeasureIndex(next);
      setMeasureSelStart(next);
    }
  };

  const handleCopy = () => {
    if (measureSelectionStart !== null) {
      const s = Math.min(measureSelectionStart, selectedMeasureIndex);
      const e = Math.max(measureSelectionStart, selectedMeasureIndex);
      copyMeasure(selectedStaffIndex, s, e);
    } else {
      copyMeasure(selectedStaffIndex, selectedMeasureIndex);
    }
    setMeasureSelStart(null);
  };

  const handlePaste = () => {
    if (copiedMeasures && copiedMeasures.length > 0) {
      pasteMeasure(selectedStaffIndex, selectedMeasureIndex, true);
      setMeasureIndex(selectedMeasureIndex + 1);
    }
  };

  const handleRemove = () => {
    if (measureCount > 1) {
      removeMeasure(selectedStaffIndex, selectedMeasureIndex);
      if (selectedMeasureIndex >= measureCount - 1)
        setMeasureIndex(Math.max(0, measureCount - 2));
    }
  };

  const range = measureSelectionStart !== null ? {
    start: Math.min(measureSelectionStart, selectedMeasureIndex),
    end:   Math.max(measureSelectionStart, selectedMeasureIndex),
  } : null;

  const rangeCount = range ? range.end - range.start + 1 : 1;
  const copiedCount = copiedMeasures?.length ?? 0;

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Measure</span>

      {/* Navigation */}
      <button
        onClick={(e) => handlePrev(e)}
        disabled={selectedMeasureIndex === 0}
        title="Previous measure (Shift+click to extend selection)"
        className={selectedMeasureIndex === 0 ? 'sv-btn-ghost opacity-30 cursor-not-allowed' : 'sv-btn-ghost'}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/>
        </svg>
      </button>

      <span className="px-2 py-1 rounded-md bg-sv-elevated border border-sv-border text-xs text-sv-text min-w-[72px] text-center font-mono">
        {range
          ? `${range.start + 1}–${range.end + 1} / ${measureCount}`
          : `${selectedMeasureIndex + 1} / ${measureCount}`}
      </span>

      {range && (
        <span className="px-1.5 py-0.5 rounded-md bg-sv-cyan/10 border border-sv-cyan/30 text-xs text-sv-cyan font-medium">
          {rangeCount} selected
        </span>
      )}

      <button
        onClick={(e) => handleNext(e)}
        disabled={selectedMeasureIndex >= measureCount - 1}
        title="Next measure (Shift+click to extend selection)"
        className={selectedMeasureIndex >= measureCount - 1 ? 'sv-btn-ghost opacity-30 cursor-not-allowed' : 'sv-btn-ghost'}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/>
        </svg>
      </button>

      <div className="w-px self-stretch bg-sv-border mx-0.5" />

      {/* Add / Remove */}
      <button onClick={() => addMeasure(selectedStaffIndex)} className="sv-btn-success text-xs" title="Add measure">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4"/>
        </svg>
        <span className="hidden sm:inline">Add</span>
      </button>
      <button
        onClick={handleRemove}
        disabled={measureCount <= 1}
        className={measureCount <= 1 ? 'sv-btn-ghost opacity-30 cursor-not-allowed text-xs' : 'sv-btn-danger text-xs'}
        title="Remove measure"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4"/>
        </svg>
        <span className="hidden sm:inline">Remove</span>
      </button>

      <div className="w-px self-stretch bg-sv-border mx-0.5" />

      {/* Copy / Paste */}
      <button
        onClick={handleCopy}
        title={range ? `Copy measures ${range.start + 1}–${range.end + 1}` : 'Copy measure (Shift+click to select range)'}
        className="sv-btn-ghost text-xs"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
        </svg>
        <span>Copy{range && rangeCount > 1 ? ` (${rangeCount})` : ''}</span>
      </button>
      <button
        onClick={handlePaste}
        disabled={copiedCount === 0}
        title={copiedCount > 0 ? `Paste ${copiedCount} measure${copiedCount > 1 ? 's' : ''}` : 'Nothing copied'}
        className={copiedCount > 0 ? 'sv-btn-ghost text-xs' : 'sv-btn-ghost text-xs opacity-30 cursor-not-allowed'}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
        </svg>
        <span>Paste{copiedCount > 0 ? ` (${copiedCount})` : ''}</span>
      </button>

      {/* Clipboard indicator */}
      {copiedCount > 0 && (
        <span className="px-1.5 py-0.5 rounded-md bg-violet-500/10 border border-violet-500/30 text-xs text-violet-400 font-medium">
          {copiedCount} copied
          {copiedStaffIndex !== null && copiedStaffIndex !== selectedStaffIndex && (
            <span className="opacity-60"> (S{copiedStaffIndex + 1})</span>
          )}
        </span>
      )}
    </div>
  );
};
