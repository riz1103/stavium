import { useState } from 'react';
import { useScoreStore } from '../../app/store/scoreStore';
import { Staff } from '../../types/music';

export const StaffControls = () => {
  const composition        = useScoreStore((state) => state.composition);
  const selectedStaffIndex = useScoreStore((state) => state.selectedStaffIndex ?? 0);
  const setSelectedStaff   = useScoreStore((state) => state.setSelectedStaffIndex);
  const addStaff           = useScoreStore((state) => state.addStaff);
  const removeStaff        = useScoreStore((state) => state.removeStaff);
  const updateStaffName    = useScoreStore((state) => state.updateStaffName);
  const setStaffHidden     = useScoreStore((state) => state.setStaffHidden);

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue,    setEditValue]    = useState('');

  if (!composition) return null;
  const visibleStaffCount = composition.staves.filter((s) => !s.hidden).length;

  const handleAdd = () => {
    const newStaff: Staff = {
      clef: 'treble',
      instrument: 'piano',
      measures: [{ number: 1, voices: [{ notes: [] }, { notes: [] }, { notes: [] }, { notes: [] }] }],
    };
    addStaff(newStaff);
    setSelectedStaff(composition.staves.length);
  };

  const handleRemove = () => {
    if (composition.staves.length > 1) {
      removeStaff(selectedStaffIndex);
      if (selectedStaffIndex >= composition.staves.length - 1)
        setSelectedStaff(Math.max(0, composition.staves.length - 2));
    }
  };

  const handleSaveEdit = (index: number) => {
    updateStaffName(index, editValue);
    setEditingIndex(null);
  };

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Staff</span>
      <div className="flex flex-col gap-1 min-w-[260px] max-h-36 overflow-y-auto pr-1">
        {composition.staves.map((staff, index) => {
          const name = staff.name || `Staff ${index + 1}`;
          const active = selectedStaffIndex === index;
          const isHidden = !!staff.hidden;
          if (editingIndex === index) {
            return (
              <div key={index} className="flex items-center gap-1">
                <input
                  autoFocus
                  type="text"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => handleSaveEdit(index)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveEdit(index);
                    else if (e.key === 'Escape') setEditingIndex(null);
                  }}
                  className="sv-input w-28 text-xs"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            );
          }
          return (
            <div
              key={index}
              className={`flex items-center justify-between gap-2 px-1 py-0.5 rounded-md border ${
                active ? 'border-sv-cyan/35 bg-sv-cyan/5' : 'border-sv-border bg-sv-card/50'
              }`}
            >
              <button
                onClick={() => setSelectedStaff(index)}
                onDoubleClick={(e) => { e.stopPropagation(); setEditingIndex(index); setEditValue(name); }}
                title={`${name} — ${staff.clef} / ${staff.instrument}. Double-tap to rename`}
                className={active ? 'sv-btn-active text-xs flex-1 justify-start' : `sv-btn-ghost text-xs flex-1 justify-start ${isHidden ? 'opacity-60' : ''}`}
              >
                {name}
                <span className="opacity-50 text-[10px]">({staff.clef[0].toUpperCase()})</span>
                {isHidden && <span className="opacity-70 text-[10px] italic">hidden</span>}
              </button>
              <button
                onClick={() => setStaffHidden(index, !isHidden)}
                disabled={!isHidden && visibleStaffCount <= 1}
                title={
                  !isHidden && visibleStaffCount <= 1
                    ? 'At least one staff must stay visible'
                    : isHidden
                    ? `Show ${name} in score and PDF`
                    : `Hide ${name} from score and PDF (playback unchanged)`
                }
                className={
                  !isHidden && visibleStaffCount <= 1
                    ? 'sv-btn-ghost text-xs opacity-30 cursor-not-allowed'
                    : isHidden
                    ? 'sv-btn-success text-xs'
                    : 'sv-btn-ghost text-xs'
                }
              >
                {isHidden ? 'Show' : 'Hide'}
              </button>
            </div>
          );
        })}
      </div>

      <div className="w-px self-stretch bg-sv-border mx-0.5" />

      <button onClick={handleAdd} className="sv-btn-success text-xs" title="Add staff">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4"/>
        </svg>
        <span className="hidden sm:inline">Add</span>
      </button>
      <button
        onClick={handleRemove}
        disabled={composition.staves.length <= 1}
        className={composition.staves.length <= 1 ? 'sv-btn-ghost opacity-30 cursor-not-allowed text-xs' : 'sv-btn-danger text-xs'}
        title="Remove selected staff"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M20 12H4"/>
        </svg>
        <span className="hidden sm:inline">Remove</span>
      </button>
    </div>
  );
};
