import { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useScoreStore } from '../../app/store/scoreStore';
import { Clef } from '../../types/music';
import { effectiveTimeSig, effectiveKeySig, effectiveTempo, effectiveClef } from '../../music/renderer/vexflowRenderer';

const TIME_SIGNATURES = ['2/4', '3/4', '4/4', '6/8', '9/8', '12/8'];
const KEY_SIGNATURES: { value: string; display: string }[] = [
  { value: 'C',  display: 'C'      }, { value: 'G',  display: 'G (1♯)' },
  { value: 'D',  display: 'D (2♯)' }, { value: 'A',  display: 'A (3♯)' },
  { value: 'E',  display: 'E (4♯)' }, { value: 'B',  display: 'B (5♯)' },
  { value: 'F#', display: 'F♯ (6♯)' }, { value: 'F',  display: 'F (1♭)' },
  { value: 'Bb', display: 'B♭ (2♭)' }, { value: 'Eb', display: 'E♭ (3♭)' },
  { value: 'Ab', display: 'A♭ (4♭)' }, { value: 'Db', display: 'D♭ (5♭)' },
  { value: 'Gb', display: 'G♭ (6♭)' },
];
const CLEFS: { value: Clef; label: string }[] = [
  { value: 'treble', label: 'Treble' }, { value: 'bass',  label: 'Bass'  },
  { value: 'alto',   label: 'Alto'   }, { value: 'tenor', label: 'Tenor' },
];

const PANEL_WIDTH = 280;
const PANEL_MARGIN = 8;

export const MeasurePropertiesPanel = () => {
  const composition        = useScoreStore((s) => s.composition);
  const selectedMeasure    = useScoreStore((s) => s.selectedMeasureIndex);
  const selectedStaff      = useScoreStore((s) => s.selectedStaffIndex);
  const updateMeasureProps = useScoreStore((s) => s.updateMeasureProperties);

  const [open, setOpen]    = useState(false);
  const [pos, setPos]      = useState<{ top: number; left: number } | null>(null);
  const btnRef             = useRef<HTMLButtonElement>(null);
  const panelRef           = useRef<HTMLDivElement>(null);

  // Position the portal panel below the trigger button
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    let left = rect.left;
    if (left + PANEL_WIDTH + PANEL_MARGIN > window.innerWidth) {
      left = window.innerWidth - PANEL_WIDTH - PANEL_MARGIN;
    }
    if (left < PANEL_MARGIN) left = PANEL_MARGIN;
    setPos({ top: rect.bottom + 6, left });
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        panelRef.current && !panelRef.current.contains(e.target as Node) &&
        btnRef.current  && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!composition || selectedMeasure === null) return null;

  const staff         = composition.staves[selectedStaff ?? 0];
  const refMeasures   = composition.staves[0]?.measures ?? [];
  const staffMeasures = staff?.measures ?? [];
  const mIdx          = selectedMeasure;

  const effTs   = effectiveTimeSig(refMeasures,   mIdx, composition.timeSignature);
  const effKs   = effectiveKeySig (refMeasures,   mIdx, composition.keySignature);
  const effTmp  = effectiveTempo  (refMeasures,   mIdx, composition.tempo);
  const effClef = effectiveClef   (staffMeasures, mIdx, staff?.clef ?? 'treble');

  const m      = refMeasures[mIdx];
  const hasTs  = !!m?.timeSignature;
  const hasKs  = !!m?.keySignature;
  const hasTmp = m?.tempo !== undefined;
  const hasClef = !!staffMeasures[mIdx]?.clef;
  const hasAny  = hasTs || hasKs || hasTmp || hasClef;

  const measureLabel = mIdx === 0 && composition.anacrusis
    ? 'Pickup'
    : `M${composition.anacrusis ? mIdx : mIdx + 1}`;

  const apply = (props: Parameters<typeof updateMeasureProps>[1]) =>
    updateMeasureProps(mIdx, props, selectedStaff ?? undefined);

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        title="Measure-level overrides"
        className={`sv-btn text-xs ${
          open
            ? 'bg-sv-cyan text-sv-bg border border-sv-cyan shadow-glow-sm'
            : 'sv-btn-ghost'
        }`}
      >
        <span>🎼</span>
        <span>{measureLabel}</span>
        {hasAny && (
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0"
                title="Has overrides" />
        )}
      </button>

      {open && pos && ReactDOM.createPortal(
        <div
          ref={panelRef}
          className="fixed z-[9999] rounded-xl shadow-2xl animate-slide-up"
          style={{
            top: pos.top,
            left: pos.left,
            width: PANEL_WIDTH,
            background: 'linear-gradient(145deg, rgba(15,20,32,0.99), rgba(15,20,32,0.97))',
            border: '1px solid rgba(38,51,71,0.9)',
            boxShadow: '0 18px 45px rgba(0,0,0,0.7)',
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-sv-elevated border-b border-sv-border rounded-t-xl">
            <h3 className="text-sm font-semibold text-sv-text">
              Changes at {measureLabel}
            </h3>
            <button
              onClick={() => setOpen(false)}
              className="w-6 h-6 flex items-center justify-center rounded text-sv-text-dim hover:text-sv-text hover:bg-sv-panel text-lg leading-none transition-colors"
            >
              ×
            </button>
          </div>

          <div className="p-4">
            <p className="text-xs text-sv-text-dim mb-4">
              Overrides apply from this measure onward until the next change.
            </p>

            {/* Time */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-sv-text-muted">Time Signature</label>
                {hasTs && <button className="text-xs text-rose-400 hover:underline" onClick={() => apply({ timeSignature: null })}>clear</button>}
              </div>
              <div className="flex items-center gap-2">
                <select value={effTs} onChange={(e) => apply({ timeSignature: e.target.value })}
                  className="sv-select flex-1 text-xs">
                  {TIME_SIGNATURES.map((ts) => <option key={ts} value={ts}>{ts}</option>)}
                </select>
                {hasTs && <span className="text-amber-400 text-xs font-bold">✎</span>}
              </div>
            </div>

            {/* Key */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-sv-text-muted">Key Signature</label>
                {hasKs && <button className="text-xs text-rose-400 hover:underline" onClick={() => apply({ keySignature: null })}>clear</button>}
              </div>
              <div className="flex items-center gap-2">
                <select value={effKs} onChange={(e) => apply({ keySignature: e.target.value })}
                  className="sv-select flex-1 text-xs">
                  {KEY_SIGNATURES.map((k) => <option key={k.value} value={k.value}>{k.display}</option>)}
                </select>
                {hasKs && <span className="text-amber-400 text-xs font-bold">✎</span>}
              </div>
            </div>

            {/* Tempo */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-sv-text-muted">Tempo (BPM)</label>
                {hasTmp && <button className="text-xs text-rose-400 hover:underline" onClick={() => apply({ tempo: null })}>clear</button>}
              </div>
              <div className="flex items-center gap-2">
                <input type="number" min={20} max={400}
                  value={effTmp}
                  onChange={(e) => apply({ tempo: Number(e.target.value) })}
                  className="sv-input w-20 text-xs" />
                <span className="text-xs text-sv-text-dim">♩= {effTmp}</span>
                {hasTmp && <span className="text-amber-400 text-xs font-bold">✎</span>}
              </div>
            </div>

            {/* Clef */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-sv-text-muted">Clef (Staff {(selectedStaff ?? 0) + 1})</label>
                {hasClef && <button className="text-xs text-rose-400 hover:underline" onClick={() => apply({ clef: null })}>clear</button>}
              </div>
              <div className="flex items-center gap-2">
                <select value={effClef} onChange={(e) => apply({ clef: e.target.value as Clef })}
                  className="sv-select flex-1 text-xs">
                  {CLEFS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                {hasClef && <span className="text-amber-400 text-xs font-bold">✎</span>}
              </div>
            </div>

            {hasAny && (
              <button
                className="w-full text-xs text-rose-400 border border-rose-500/30 rounded-lg py-1.5 hover:bg-rose-500/10 transition-colors"
                onClick={() => apply({ timeSignature: null, keySignature: null, tempo: null, clef: null })}
              >
                Clear all overrides
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};
