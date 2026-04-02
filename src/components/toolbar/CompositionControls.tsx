import { useScoreStore } from '../../app/store/scoreStore';
import { usePlaybackStore } from '../../app/store/playbackStore';

const TIME_SIGNATURES = ['2/2', '2/4', '3/8', '3/4', '4/4', '5/4', '5/8', '6/4', '6/8', '7/4', '7/8', '9/8', '12/8', '12/16'];

const KEY_SIGNATURES: { value: string; display: string; description: string }[] = [
  { value: 'C',  display: 'C',       description: 'No sharps or flats'              },
  { value: 'G',  display: 'G (1♯)',  description: '1 sharp: F♯'                     },
  { value: 'D',  display: 'D (2♯)',  description: '2 sharps: F♯, C♯'               },
  { value: 'A',  display: 'A (3♯)',  description: '3 sharps: F♯, C♯, G♯'           },
  { value: 'E',  display: 'E (4♯)',  description: '4 sharps: F♯, C♯, G♯, D♯'      },
  { value: 'B',  display: 'B (5♯)',  description: '5 sharps: F♯, C♯, G♯, D♯, A♯' },
  { value: 'F#', display: 'F♯ (6♯)', description: '6 sharps'                        },
  { value: 'C#', display: 'C♯ (7♯)', description: '7 sharps'                        },
  { value: 'F',  display: 'F (1♭)',  description: '1 flat: B♭'                      },
  { value: 'Bb', display: 'B♭ (2♭)', description: '2 flats: B♭, E♭'               },
  { value: 'Eb', display: 'E♭ (3♭)', description: '3 flats: B♭, E♭, A♭'           },
  { value: 'Ab', display: 'A♭ (4♭)', description: '4 flats: B♭, E♭, A♭, D♭'      },
  { value: 'Db', display: 'D♭ (5♭)', description: '5 flats: B♭, E♭, A♭, D♭, G♭' },
  { value: 'Gb', display: 'G♭ (6♭)', description: '6 flats'                         },
  { value: 'Cb', display: 'C♭ (7♭)', description: '7 flats'                         },
  { value: 'Am', display: 'A minor', description: 'Relative minor of C major' },
  { value: 'Em', display: 'E minor', description: 'Relative minor of G major' },
  { value: 'Bm', display: 'B minor', description: 'Relative minor of D major' },
  { value: 'F#m', display: 'F♯ minor', description: 'Relative minor of A major' },
  { value: 'C#m', display: 'C♯ minor', description: 'Relative minor of E major' },
  { value: 'G#m', display: 'G♯ minor', description: 'Relative minor of B major' },
  { value: 'D#m', display: 'D♯ minor', description: 'Relative minor of F♯ major' },
  { value: 'A#m', display: 'A♯ minor', description: 'Relative minor of C♯ major' },
  { value: 'Dm', display: 'D minor', description: 'Relative minor of F major' },
  { value: 'Gm', display: 'G minor', description: 'Relative minor of B♭ major' },
  { value: 'Cm', display: 'C minor', description: 'Relative minor of E♭ major' },
  { value: 'Fm', display: 'F minor', description: 'Relative minor of A♭ major' },
  { value: 'Bbm', display: 'B♭ minor', description: 'Relative minor of D♭ major' },
  { value: 'Ebm', display: 'E♭ minor', description: 'Relative minor of G♭ major' },
  { value: 'Abm', display: 'A♭ minor', description: 'Relative minor of C♭ major' },
];

function pickupBeatOptions(ts: string): number[] {
  const [beats] = ts.split('/').map(Number);
  return Array.from({ length: beats - 1 }, (_, i) => i + 1);
}

interface CompositionControlsProps {
  isReadOnly?: boolean;
}

export const CompositionControls = ({ isReadOnly = false }: CompositionControlsProps) => {
  const composition           = useScoreStore((s) => s.composition);
  const updateNotationSystem  = useScoreStore((s) => s.updateNotationSystem);
  const updateChantSpacingDensity = useScoreStore((s) => s.updateChantSpacingDensity);
  const updateChantInterpretation = useScoreStore((s) => s.updateChantInterpretation);
  const updateTimeSignature   = useScoreStore((s) => s.updateTimeSignature);
  const updateKeySignature    = useScoreStore((s) => s.updateKeySignature);
  const updateTempo           = useScoreStore((s) => s.updateTempo);
  const setAnacrusis          = useScoreStore((s) => s.setAnacrusis);
  const setShowMeasureNumbers = useScoreStore((s) => s.setShowMeasureNumbers);
  
  // Playback tempo for view-only users
  const playbackTempo = usePlaybackStore((s) => s.playbackTempo);
  const setPlaybackTempo = usePlaybackStore((s) => s.setPlaybackTempo);
  const getEffectiveTempo = usePlaybackStore((s) => s.getEffectiveTempo);

  if (!composition) return null;

  const beatOptions   = pickupBeatOptions(composition.timeSignature);
  const currentPickup = composition.pickupBeats ?? 1;
  
  // For view-only users, use playback tempo; for editors, use composition tempo
  const displayTempo = isReadOnly 
    ? (playbackTempo !== null ? playbackTempo : composition.tempo)
    : composition.tempo;
  const isGregorianChant = composition.notationSystem === 'gregorian-chant';

  return (
    <div className="sv-toolbar flex-wrap gap-y-2">

      {!isReadOnly && (
        <div className="flex items-center gap-1.5">
          <span className="sv-toolbar-label">Notation</span>
          <select
            value={composition.notationSystem ?? 'standard'}
            onChange={(e) => updateNotationSystem(e.target.value as 'standard' | 'gregorian-chant')}
            className="sv-select w-36"
          >
            <option value="standard">Standard staff</option>
            <option value="gregorian-chant">Gregorian chant</option>
          </select>
        </div>
      )}

      {!isReadOnly && isGregorianChant && (
        <div className="flex items-center gap-1.5">
          <span className="sv-toolbar-label">Spacing</span>
          <select
            value={composition.chantSpacingDensity ?? 'normal'}
            onChange={(e) => updateChantSpacingDensity(e.target.value as 'tight' | 'normal' | 'spacious')}
            className="sv-select w-24"
            title="Gregorian chant spacing density"
          >
            <option value="tight">Tight</option>
            <option value="normal">Normal</option>
            <option value="spacious">Spacious</option>
          </select>
        </div>
      )}
      {!isReadOnly && isGregorianChant && (
        <div className="flex items-center gap-1.5">
          <span className="sv-toolbar-label">Interpret</span>
          <select
            value={composition.chantInterpretation ?? 'medium'}
            onChange={(e) => updateChantInterpretation(e.target.value as 'subtle' | 'medium' | 'expressive')}
            className="sv-select w-28"
            title="Ornament timing profile for Gregorian playback"
          >
            <option value="subtle">Subtle</option>
            <option value="medium">Medium</option>
            <option value="expressive">Expressive</option>
          </select>
        </div>
      )}

      {/* Time Signature */}
      {!isReadOnly && !isGregorianChant && (
        <div className="flex items-center gap-1.5">
          <span className="sv-toolbar-label">Time</span>
          <select
            value={composition.timeSignature}
            onChange={(e) => updateTimeSignature(e.target.value)}
            className="sv-select w-20"
          >
            {TIME_SIGNATURES.map((ts) => <option key={ts} value={ts}>{ts}</option>)}
          </select>
        </div>
      )}

      {/* Key Signature */}
      {!isReadOnly && !isGregorianChant && (
        <div className="flex items-center gap-1.5">
          <span className="sv-toolbar-label">Key</span>
          <select
            value={composition.keySignature}
            onChange={(e) => updateKeySignature(e.target.value)}
            title={KEY_SIGNATURES.find((k) => k.value === composition.keySignature)?.description}
            className="sv-select w-24"
          >
            {KEY_SIGNATURES.map((k) => (
              <option key={k.value} value={k.value} title={k.description}>{k.display}</option>
            ))}
          </select>
        </div>
      )}

      {/* Tempo */}
      <div className="flex items-center gap-1.5">
        <span className="sv-toolbar-label">Tempo</span>
        <input
          type="number" min="40" max="300"
          value={displayTempo}
          onChange={(e) => {
            const newTempo = parseInt(e.target.value, 10) || 120;
            if (isReadOnly) {
              // For view-only users, only update playback tempo (for playback/study)
              setPlaybackTempo(newTempo);
            } else {
              // For editors, update the composition tempo
              updateTempo(newTempo);
            }
          }}
          className="sv-input w-16 text-center"
          title={isReadOnly ? "Playback tempo (for study/playback only, doesn't save)" : "Composition tempo"}
        />
        <span className="text-xs text-sv-text-dim">BPM</span>
        {isReadOnly && playbackTempo !== null && (
          <span className="text-xs text-amber-400" title="Using playback tempo">🎵</span>
        )}
      </div>

      {!isReadOnly && !isGregorianChant && (
        <>
          <div className="w-px self-stretch bg-sv-border mx-0.5" />

          {/* Pickup measure */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-sv-text-muted">
            <input
              type="checkbox"
              checked={!!composition.anacrusis}
              onChange={(e) => setAnacrusis(e.target.checked, currentPickup)}
              className="w-3.5 h-3.5"
            />
            <span>Pickup</span>
          </label>
          {composition.anacrusis && beatOptions.length > 0 && (
            <select
              value={currentPickup}
              onChange={(e) => setAnacrusis(true, Number(e.target.value))}
              className="sv-select w-20"
              title="Pickup beats"
            >
              {beatOptions.map((b) => (
                <option key={b} value={b}>{b} beat{b !== 1 ? 's' : ''}</option>
              ))}
            </select>
          )}

          {/* Measure numbers */}
          <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs text-sv-text-muted">
            <input
              type="checkbox"
              checked={composition.showMeasureNumbers !== false}
              onChange={(e) => setShowMeasureNumbers(e.target.checked)}
              className="w-3.5 h-3.5"
            />
            <span>Measure #</span>
          </label>
        </>
      )}

    </div>
  );
};
