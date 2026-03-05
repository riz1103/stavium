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

  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue,    setEditValue]    = useState('');

  if (!composition) return null;

  const handleAdd = () => {
    const newStaff: Staff = {
      clef: 'treble',
      instrument: 'piano',
      measures: [{ number: 1, voices: [{ notes: [] }] }],
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
      <div className="flex items-center gap-1 flex-wrap">
        {composition.staves.map((staff, index) => {
          const name = staff.name || `Staff ${index + 1}`;
          const active = selectedStaffIndex === index;
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
            <button
              key={index}
              onClick={() => setSelectedStaff(index)}
              onDoubleClick={(e) => { e.stopPropagation(); setEditingIndex(index); setEditValue(name); }}
              title={`${name} — ${staff.clef} / ${staff.instrument}. Double-tap to rename`}
              className={active ? 'sv-btn-active text-xs' : 'sv-btn-ghost text-xs'}
            >
              {name}
              <span className="opacity-50 text-[10px]">({staff.clef[0].toUpperCase()})</span>
            </button>
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
