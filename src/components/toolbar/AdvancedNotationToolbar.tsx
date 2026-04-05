import { useScoreStore } from '../../app/store/scoreStore';
import type { NavigationMark, Note, OttavaType } from '../../types/music';

const GRACE_OPTIONS: Array<{ value: Note['grace'] | undefined; label: string }> = [
  { value: undefined, label: 'None' },
  { value: 'acciaccatura', label: 'Acciacc.' },
  { value: 'appoggiatura', label: 'Appogg.' },
];

const TREMOLO_LEVELS: Array<0 | 1 | 2 | 3 | 4> = [0, 1, 2, 3, 4];
const OTTAVA_OPTIONS: OttavaType[] = ['8va', '8vb', '15ma', '15mb'];
const NAVIGATION_OPTIONS: NavigationMark[] = [
  'D.C.',
  'D.C. al Coda',
  'D.S.',
  'D.S. al Coda',
  'To Coda',
  'Fine',
];

const normalizeEnding = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
};

export const AdvancedNotationToolbar = () => {
  const composition = useScoreStore((s) => s.composition);
  const selectedNote = useScoreStore((s) => s.selectedNote);
  const selectedMeasureIndex = useScoreStore((s) => s.selectedMeasureIndex);
  const selectedStaffIndex = useScoreStore((s) => s.selectedStaffIndex);
  const updateNote = useScoreStore((s) => s.updateNote);
  const updateMeasureProperties = useScoreStore((s) => s.updateMeasureProperties);

  if (!composition) return null;

  const activeStaffIndex = selectedStaffIndex ?? 0;
  const activeMeasureIndex = selectedMeasureIndex ?? 0;
  const activeMeasure = composition.staves[activeStaffIndex]?.measures[activeMeasureIndex];
  if (!activeMeasure) return null;

  let currentNote: Note | null = null;
  if (selectedNote) {
    const candidate = composition.staves[selectedNote.staffIndex]?.measures[selectedNote.measureIndex]
      ?.voices[selectedNote.voiceIndex]?.notes[selectedNote.noteIndex];
    if (candidate && 'pitch' in candidate) currentNote = candidate as Note;
  }

  return (
    <div className="sv-toolbar" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
      <span className="sv-toolbar-label">Advanced Notation</span>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        <button
          className={activeMeasure.repeatStart ? 'sv-btn-active' : 'sv-btn-ghost'}
          onClick={() => updateMeasureProperties(activeMeasureIndex, { repeatStart: !activeMeasure.repeatStart }, activeStaffIndex)}
          title="Toggle repeat start at this measure"
        >
          :|
        </button>
        <button
          className={activeMeasure.repeatEnd ? 'sv-btn-active' : 'sv-btn-ghost'}
          onClick={() => updateMeasureProperties(activeMeasureIndex, { repeatEnd: !activeMeasure.repeatEnd }, activeStaffIndex)}
          title="Toggle repeat end at this measure"
        >
          |:
        </button>
        <button
          className={activeMeasure.segno ? 'sv-btn-active' : 'sv-btn-ghost'}
          onClick={() => updateMeasureProperties(activeMeasureIndex, { segno: !activeMeasure.segno }, activeStaffIndex)}
          title="Toggle segno symbol"
        >
          Segno
        </button>
        <button
          className={activeMeasure.coda ? 'sv-btn-active' : 'sv-btn-ghost'}
          onClick={() => updateMeasureProperties(activeMeasureIndex, { coda: !activeMeasure.coda }, activeStaffIndex)}
          title="Toggle coda symbol"
        >
          Coda
        </button>
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          className="sv-select text-xs"
          value={activeMeasure.navigation ?? ''}
          onChange={(e) =>
            updateMeasureProperties(
              activeMeasureIndex,
              { navigation: (e.target.value || null) as NavigationMark | null },
              activeStaffIndex
            )
          }
          title="Set navigation mark (D.S./D.C./To Coda/Fine)"
        >
          <option value="">Navigation...</option>
          {NAVIGATION_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <input
          className="sv-input text-xs w-20"
          placeholder="Ending"
          value={activeMeasure.ending ?? ''}
          onChange={(e) =>
            updateMeasureProperties(activeMeasureIndex, { ending: normalizeEnding(e.target.value) ?? null }, activeStaffIndex)
          }
          title="Volta ending label (for example 1. or 2.)"
        />
      </div>

      {currentNote && selectedNote && (
        <>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              className="sv-select text-xs"
              value={currentNote.grace ?? ''}
              onChange={(e) =>
                updateNote(selectedNote.staffIndex, selectedNote.measureIndex, selectedNote.voiceIndex, selectedNote.noteIndex, {
                  grace: (e.target.value || undefined) as Note['grace'],
                })
              }
              title="Grace note style for selected note"
            >
              {GRACE_OPTIONS.map((option) => (
                <option key={option.label} value={option.value ?? ''}>
                  Grace: {option.label}
                </option>
              ))}
            </select>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span className="text-[10px] text-sv-text-dim">Tremolo</span>
              {TREMOLO_LEVELS.map((level) => (
                <button
                  key={level}
                  className={(currentNote?.tremolo ?? 0) === level ? 'sv-btn-active' : 'sv-btn-ghost'}
                  onClick={() =>
                    updateNote(selectedNote.staffIndex, selectedNote.measureIndex, selectedNote.voiceIndex, selectedNote.noteIndex, {
                      tremolo: level === 0 ? undefined : (level as 1 | 2 | 3 | 4),
                    })
                  }
                  title={level === 0 ? 'No tremolo slashes' : `${level} tremolo slashes`}
                >
                  {level === 0 ? '0' : '/'.repeat(level)}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              className="sv-select text-xs"
              value={currentNote?.ottavaStart ?? ''}
              onChange={(e) =>
                updateNote(selectedNote.staffIndex, selectedNote.measureIndex, selectedNote.voiceIndex, selectedNote.noteIndex, {
                  ottavaStart: (e.target.value || undefined) as OttavaType | undefined,
                })
              }
              title="Start ottava line at selected note"
            >
              <option value="">Ottava start...</option>
              {OTTAVA_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <button
              className={currentNote?.ottavaEnd ? 'sv-btn-active' : 'sv-btn-ghost'}
              onClick={() =>
                updateNote(selectedNote.staffIndex, selectedNote.measureIndex, selectedNote.voiceIndex, selectedNote.noteIndex, {
                  ottavaEnd: !currentNote?.ottavaEnd || undefined,
                })
              }
              title="End active ottava line at this note"
            >
              Ottava End
            </button>
            <button
              className={currentNote?.pedalStart ? 'sv-btn-active' : 'sv-btn-ghost'}
              onClick={() =>
                updateNote(selectedNote.staffIndex, selectedNote.measureIndex, selectedNote.voiceIndex, selectedNote.noteIndex, {
                  pedalStart: !currentNote?.pedalStart || undefined,
                })
              }
              title="Start pedal line at this note"
            >
              Ped.
            </button>
            <button
              className={currentNote?.pedalEnd ? 'sv-btn-active' : 'sv-btn-ghost'}
              onClick={() =>
                updateNote(selectedNote.staffIndex, selectedNote.measureIndex, selectedNote.voiceIndex, selectedNote.noteIndex, {
                  pedalEnd: !currentNote?.pedalEnd || undefined,
                })
              }
              title="End pedal line at this note"
            >
              ✶
            </button>
          </div>
        </>
      )}
    </div>
  );
};
