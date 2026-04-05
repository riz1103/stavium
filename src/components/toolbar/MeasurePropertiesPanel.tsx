import { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useScoreStore } from '../../app/store/scoreStore';
import { Clef, GregorianChantDivision, NavigationMark } from '../../types/music';
import { effectiveTimeSig, effectiveKeySig, effectiveTempo, effectiveClef } from '../../music/renderer/vexflowRenderer';

const TIME_SIGNATURES = ['2/2', '2/4', '3/8', '3/4', '4/4', '5/4', '5/8', '6/4', '6/8', '7/4', '7/8', '9/8', '12/8', '12/16'];
const KEY_SIGNATURES: { value: string; display: string }[] = [
  { value: 'C',  display: 'C'      }, { value: 'G',  display: 'G (1♯)' },
  { value: 'D',  display: 'D (2♯)' }, { value: 'A',  display: 'A (3♯)' },
  { value: 'E',  display: 'E (4♯)' }, { value: 'B',  display: 'B (5♯)' },
  { value: 'F#', display: 'F♯ (6♯)' }, { value: 'C#', display: 'C♯ (7♯)' },
  { value: 'F',  display: 'F (1♭)' },
  { value: 'Bb', display: 'B♭ (2♭)' }, { value: 'Eb', display: 'E♭ (3♭)' },
  { value: 'Ab', display: 'A♭ (4♭)' }, { value: 'Db', display: 'D♭ (5♭)' },
  { value: 'Gb', display: 'G♭ (6♭)' }, { value: 'Cb', display: 'C♭ (7♭)' },
  { value: 'Am', display: 'A minor' }, { value: 'Em', display: 'E minor' },
  { value: 'Bm', display: 'B minor' }, { value: 'F#m', display: 'F♯ minor' },
  { value: 'C#m', display: 'C♯ minor' }, { value: 'G#m', display: 'G♯ minor' },
  { value: 'D#m', display: 'D♯ minor' }, { value: 'A#m', display: 'A♯ minor' },
  { value: 'Dm', display: 'D minor' }, { value: 'Gm', display: 'G minor' },
  { value: 'Cm', display: 'C minor' }, { value: 'Fm', display: 'F minor' },
  { value: 'Bbm', display: 'B♭ minor' }, { value: 'Ebm', display: 'E♭ minor' },
  { value: 'Abm', display: 'A♭ minor' },
];
const CLEFS: { value: Clef; label: string }[] = [
  { value: 'treble', label: 'Treble' }, { value: 'bass',  label: 'Bass'  },
  { value: 'alto',   label: 'Alto'   }, { value: 'tenor', label: 'Tenor' },
];
const GREGORIAN_CLEFS: { value: Clef; label: string }[] = [
  { value: 'alto', label: 'Do (C) clef' },
  { value: 'bass', label: 'Fa (F) clef' },
];
const CHANT_DIVISIONS: { value: GregorianChantDivision; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'minima', label: 'Divisio minima' },
  { value: 'minor', label: 'Divisio minor' },
  { value: 'major', label: 'Divisio maior' },
  { value: 'finalis', label: 'Finalis' },
];
const NAVIGATION_MARKS: NavigationMark[] = ['D.C.', 'D.C. al Coda', 'D.S.', 'D.S. al Coda', 'To Coda', 'Fine'];

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
  const isGregorianChant = composition.notationSystem === 'gregorian-chant';
  const clefOptions = isGregorianChant ? GREGORIAN_CLEFS : CLEFS;
  const hasClef = !!staffMeasures[mIdx]?.clef;
  const chantDivision = (staffMeasures[mIdx]?.chantDivision ?? 'none') as GregorianChantDivision;
  const hasDivision = chantDivision !== 'none';
  const hasRepeatStart = !!staffMeasures[mIdx]?.repeatStart;
  const hasRepeatEnd = !!staffMeasures[mIdx]?.repeatEnd;
  const ending = staffMeasures[mIdx]?.ending ?? '';
  const navigation = staffMeasures[mIdx]?.navigation;
  const hasSegno = !!staffMeasures[mIdx]?.segno;
  const hasCoda = !!staffMeasures[mIdx]?.coda;
  const hasAnyAdvanced = hasRepeatStart || hasRepeatEnd || !!ending || !!navigation || hasSegno || hasCoda;
  const hasAny  = hasClef || hasDivision || hasAnyAdvanced || (!isGregorianChant && (hasTs || hasKs || hasTmp));

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

            {!isGregorianChant && (
              <>
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
              </>
            )}

            {/* Clef */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-medium text-sv-text-muted">Clef (Staff {(selectedStaff ?? 0) + 1})</label>
                {hasClef && <button className="text-xs text-rose-400 hover:underline" onClick={() => apply({ clef: null })}>clear</button>}
              </div>
              <div className="flex items-center gap-2">
                <select value={effClef} onChange={(e) => apply({ clef: e.target.value as Clef })}
                  className="sv-select flex-1 text-xs">
                  {clefOptions.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
                {hasClef && <span className="text-amber-400 text-xs font-bold">✎</span>}
              </div>
            </div>

            {isGregorianChant && (
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-sv-text-muted">Chant division</label>
                  {hasDivision && (
                    <button
                      className="text-xs text-rose-400 hover:underline"
                      onClick={() => apply({ chantDivision: null })}
                    >
                      clear
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={chantDivision}
                    onChange={(e) => apply({ chantDivision: e.target.value as GregorianChantDivision })}
                    className="sv-select flex-1 text-xs"
                  >
                    {CHANT_DIVISIONS.map((d) => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                  {hasDivision && <span className="text-amber-400 text-xs font-bold">✎</span>}
                </div>
              </div>
            )}

            {!isGregorianChant && (
              <div className="mb-3 border-t border-sv-border pt-3">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-sv-text-muted">Repeats / Endings / Navigation</label>
                  {hasAnyAdvanced && (
                    <button
                      className="text-xs text-rose-400 hover:underline"
                      onClick={() =>
                        apply({
                          repeatStart: null,
                          repeatEnd: null,
                          ending: null,
                          navigation: null,
                          segno: null,
                          coda: null,
                        })
                      }
                    >
                      clear
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 mb-2">
                  <button
                    className={hasRepeatStart ? 'sv-btn-active text-xs' : 'sv-btn-ghost text-xs'}
                    onClick={() => apply({ repeatStart: !hasRepeatStart })}
                  >
                    Repeat Start
                  </button>
                  <button
                    className={hasRepeatEnd ? 'sv-btn-active text-xs' : 'sv-btn-ghost text-xs'}
                    onClick={() => apply({ repeatEnd: !hasRepeatEnd })}
                  >
                    Repeat End
                  </button>
                  <button
                    className={hasSegno ? 'sv-btn-active text-xs' : 'sv-btn-ghost text-xs'}
                    onClick={() => apply({ segno: !hasSegno })}
                  >
                    Segno
                  </button>
                  <button
                    className={hasCoda ? 'sv-btn-active text-xs' : 'sv-btn-ghost text-xs'}
                    onClick={() => apply({ coda: !hasCoda })}
                  >
                    Coda
                  </button>
                </div>

                <div className="flex items-center gap-2 mb-2">
                  <input
                    type="text"
                    value={ending}
                    placeholder="Ending (1., 2.)"
                    onChange={(e) => apply({ ending: e.target.value.trim() ? e.target.value : null })}
                    className="sv-input flex-1 text-xs"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <select
                    className="sv-select flex-1 text-xs"
                    value={navigation ?? ''}
                    onChange={(e) => apply({ navigation: (e.target.value || null) as NavigationMark | null })}
                  >
                    <option value="">Navigation mark...</option>
                    {NAVIGATION_MARKS.map((mark) => (
                      <option key={mark} value={mark}>
                        {mark}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}

            {hasAny && (
              <button
                className="w-full text-xs text-rose-400 border border-rose-500/30 rounded-lg py-1.5 hover:bg-rose-500/10 transition-colors"
                onClick={() => apply(isGregorianChant
                  ? { clef: null, chantDivision: null }
                  : {
                    timeSignature: null,
                    keySignature: null,
                    tempo: null,
                    clef: null,
                    chantDivision: null,
                    repeatStart: null,
                    repeatEnd: null,
                    ending: null,
                    navigation: null,
                    segno: null,
                    coda: null,
                  })}
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
