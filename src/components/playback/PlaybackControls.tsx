import { useEffect, useRef, useState } from 'react';
import { useScoreStore } from '../../app/store/scoreStore';
import { usePlaybackStore } from '../../app/store/playbackStore';
import { sharedScheduler } from '../../music/playback/toneScheduler';
import { MidiInputPanel } from '../input/MidiInputPanel';

export const PlaybackControls = ({ isReadOnly = false }: { isReadOnly?: boolean }) => {
  const composition = useScoreStore((state) => state.composition);
  const playbackState = usePlaybackStore((state) => state.state);
  const setPlaybackState = usePlaybackStore((state) => state.setState);
  const getEffectiveTempo = usePlaybackStore((state) => state.getEffectiveTempo);
  const playbackStartMeasure = usePlaybackStore((state) => state.playbackStartMeasure);
  const playbackEndMeasure = usePlaybackStore((state) => state.playbackEndMeasure);
  const setPlaybackRange = usePlaybackStore((state) => state.setPlaybackRange);
  const isLooping = usePlaybackStore((state) => state.isLooping);
  const setLooping = usePlaybackStore((state) => state.setLooping);
  const playChords = usePlaybackStore((state) => state.playChords);
  const setPlayChords = usePlaybackStore((state) => state.setPlayChords);
  const expressivePlayback = usePlaybackStore((state) => state.expressivePlayback);
  const setExpressivePlayback = usePlaybackStore((state) => state.setExpressivePlayback);
  const metronomeEnabled = usePlaybackStore((state) => state.metronomeEnabled);
  const setMetronomeEnabled = usePlaybackStore((state) => state.setMetronomeEnabled);
  const countInEnabled = usePlaybackStore((state) => state.countInEnabled);
  const setCountInEnabled = usePlaybackStore((state) => state.setCountInEnabled);
  const countInBars = usePlaybackStore((state) => state.countInBars);
  const setCountInBars = usePlaybackStore((state) => state.setCountInBars);
  const selectedMeasureIndex = useScoreStore((state) => state.selectedMeasureIndex);
  const measureSelectionStart = useScoreStore((state) => state.measureSelectionStart);
  const schedulerRef = useRef(sharedScheduler);
  const [isLoading, setIsLoading] = useState(false);

  // Preload instruments when composition is loaded (background, non-blocking).
  // Piano is usually already cached from the Dashboard preload, so this is fast.
  useEffect(() => {
    if (!composition) return;
    
    schedulerRef.current.preloadInstruments(composition, true).catch((err) => {
      console.debug('Instrument preloading failed:', err);
    });
  }, [composition]);

  useEffect(() => {
    return () => {
      schedulerRef.current.setPlaybackCompleteCallback(null);
    };
  }, []);

  const startPlayback = async () => {
    if (!composition || !schedulerRef.current) return;
    setIsLoading(true);
    try {
      const effectiveTempo = getEffectiveTempo(composition.tempo);
      schedulerRef.current.setPlaybackCompleteCallback(async () => {
        const shouldLoop = usePlaybackStore.getState().isLooping;
        if (!shouldLoop) {
          setPlaybackState('stopped');
          return;
        }
        try {
          await startPlayback();
          setPlaybackState('playing');
        } catch {
          setPlaybackState('stopped');
        }
      });
      await schedulerRef.current.playComposition(
        composition,
        {
          playbackTempo: effectiveTempo,
          startMeasure: playbackStartMeasure,
          endMeasure: playbackEndMeasure,
          playChords,
          expressivePlayback,
          metronomeEnabled,
          countInEnabled,
          countInBars,
        }
      );
      setPlaybackState('playing');
    } catch (err) {
      console.error('Playback error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePlay = async () => {
    if (!composition || !schedulerRef.current) return;
    if (playbackState === 'paused') {
      schedulerRef.current.resume();
      setPlaybackState('playing');
      return;
    }
    await startPlayback();
  };

  const handleReplay = async () => {
    if (!composition || !schedulerRef.current) return;
    // Stop current playback first
    schedulerRef.current.stop();
    setPlaybackState('stopped');
    // Small delay to ensure stop completes
    setTimeout(() => {
      startPlayback();
    }, 100);
  };

  const handlePause = () => { schedulerRef.current?.pause(); setPlaybackState('paused'); };
  const handleStop  = () => {
    schedulerRef.current?.setPlaybackCompleteCallback(null);
    schedulerRef.current?.stop();
    setPlaybackState('stopped');
  };

  const hasNotes = composition?.staves.some((s) =>
    s.measures.some((m) => m.voices.some((v) => v.notes.length > 0))
  );
  const getEffectiveInstrument = usePlaybackStore((state) => state.getEffectiveInstrument);
  const currentInstrument = composition
    ? getEffectiveInstrument(0, composition.staves[0]?.instrument ?? 'piano')
    : 'piano';
  const isGregorianChant = composition?.notationSystem === 'gregorian-chant';
  const isPlaying = playbackState === 'playing';
  const isPaused  = playbackState === 'paused';
  
  // Get total number of measures
  const totalMeasures = composition?.staves[0]?.measures.length ?? 0;
  const measureOptions = Array.from({ length: totalMeasures }, (_, i) => i + 1);
  const hasMeasureSelection = selectedMeasureIndex !== null;
  const selectedRangeStart = hasMeasureSelection
    ? Math.min(selectedMeasureIndex, measureSelectionStart ?? selectedMeasureIndex)
    : null;
  const selectedRangeEnd = hasMeasureSelection
    ? Math.max(selectedMeasureIndex, measureSelectionStart ?? selectedMeasureIndex)
    : null;

  const handleLoopSelection = () => {
    if (selectedRangeStart === null || selectedRangeEnd === null) return;
    setPlaybackRange(selectedRangeStart, selectedRangeEnd);
    setLooping(true);
  };

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 md:gap-2 md:px-4 md:py-2.5 flex-wrap">
      {/* Transport controls */}
      <div className="flex items-center gap-1">
        {/* Play / Resume */}
        <button
          type="button"
          data-tour-id="tour-play-button"
          onClick={handlePlay}
          disabled={!hasNotes || isPlaying || isLoading}
          className={`flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-150
            ${!hasNotes || isPlaying || isLoading
              ? 'bg-sv-elevated text-sv-text-dim cursor-not-allowed'
              : 'bg-sv-cyan text-sv-bg hover:bg-sv-cyan-dim shadow-glow-sm'
            }`}
          title={!hasNotes ? 'Add notes first' : isPaused ? 'Resume' : 'Play'}
        >
          {isLoading ? (
            <span className="w-4 h-4 border-2 border-sv-bg border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Pause */}
        <button
          onClick={handlePause}
          disabled={!isPlaying}
          className={`flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-150
            ${isPlaying
              ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 hover:bg-amber-500/30'
              : 'bg-sv-elevated text-sv-text-dim cursor-not-allowed'
            }`}
          title="Pause"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
          </svg>
        </button>

        {/* Stop */}
        <button
          onClick={handleStop}
          disabled={playbackState === 'stopped'}
          className={`flex items-center justify-center w-9 h-9 rounded-lg transition-all duration-150
            ${playbackState !== 'stopped'
              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 hover:bg-rose-500/30'
              : 'bg-sv-elevated text-sv-text-dim cursor-not-allowed'
            }`}
          title="Stop"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 6h12v12H6z" />
          </svg>
        </button>
      </div>

      {/* Measure Range Selection */}
      {composition && totalMeasures > 0 && !isGregorianChant && (
        <div className="flex items-center gap-2 sm:ml-2 px-3 py-1.5 bg-sv-elevated rounded-lg border border-sv-border">
          <span className="text-xs text-sv-text-muted">From:</span>
          <select
            value={playbackStartMeasure ?? ''}
            onChange={(e) => setPlaybackRange(
              e.target.value ? Number(e.target.value) - 1 : null,
              playbackEndMeasure
            )}
            className="sv-select w-16 text-xs"
            disabled={isPlaying}
          >
            <option value="">Start</option>
            {measureOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <span className="text-xs text-sv-text-muted">To:</span>
          <select
            value={playbackEndMeasure !== null ? playbackEndMeasure + 1 : ''}
            onChange={(e) => setPlaybackRange(
              playbackStartMeasure,
              e.target.value ? Number(e.target.value) - 1 : null
            )}
            className="sv-select w-16 text-xs"
            disabled={isPlaying}
          >
            <option value="">End</option>
            {measureOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          {(playbackStartMeasure !== null || playbackEndMeasure !== null) && (
            <button
              onClick={handleReplay}
              disabled={isPlaying || isLoading}
              className="flex items-center justify-center w-7 h-7 rounded-md bg-sv-cyan/20 text-sv-cyan hover:bg-sv-cyan/30 border border-sv-cyan/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Replay from start measure"
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
              </svg>
            </button>
          )}
          <label className="flex items-center gap-1.5 ml-1 cursor-pointer">
            <input
              type="checkbox"
              checked={isLooping}
              onChange={(e) => setLooping(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-sv-border text-sv-cyan focus:ring-sv-cyan/50"
            />
            <span className="text-xs text-sv-text" title="Repeat playback when reaching the end of range">Loop</span>
          </label>
          <button
            onClick={handleLoopSelection}
            disabled={selectedRangeStart === null || selectedRangeEnd === null || isPlaying}
            className="px-2 py-1 rounded-md text-xs border border-sv-cyan/40 text-sv-cyan bg-sv-cyan/10 hover:bg-sv-cyan/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Use selected measure range and enable loop"
          >
            Loop Selection
          </button>
        </div>
      )}

      {/* Status / Info */}
      {composition && (
        <div className="flex items-center gap-2 sm:ml-2 text-sm text-sv-text-muted">
          {/* Playing indicator */}
          {isPlaying && (
            <span className="flex items-center gap-1.5 text-sv-cyan text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-sv-cyan animate-pulse" />
              Playing
            </span>
          )}
          {isPaused && (
            <span className="flex items-center gap-1.5 text-amber-400 text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              Paused
            </span>
          )}

          {/* Instrument + BPM */}
          <span className="hidden sm:inline font-medium text-sv-text-muted capitalize">
            {currentInstrument}
          </span>
          <span className="hidden sm:inline text-sv-text-dim">·</span>
          <span className="text-sv-text-muted">
            {composition ? getEffectiveTempo(composition.tempo) : 120} <span className="text-xs text-sv-text-dim">BPM</span>
          </span>
          {countInEnabled && (
            <>
              <span className="hidden sm:inline text-sv-text-dim">·</span>
              <span className="text-xs text-sv-cyan" title="Count-in before playback starts">
                Count-in: {countInBars} {countInBars === 1 ? 'bar' : 'bars'}
              </span>
            </>
          )}
          {metronomeEnabled && (
            <>
              <span className="hidden sm:inline text-sv-text-dim">·</span>
              <span className="text-xs text-sv-cyan/90" title="Metronome click track is enabled">
                Metronome On
              </span>
            </>
          )}

          {/* Hint */}
          {!hasNotes && (
            <span className="text-xs text-sv-text-dim italic">
              (add notes to play)
            </span>
          )}

          {isLoading && (
            <span className="text-xs text-sv-cyan animate-pulse">
              Loading {currentInstrument}…
            </span>
          )}
        </div>
      )}

      {!isGregorianChant && (
        <div className="flex items-center flex-wrap gap-2 sm:gap-3 px-2 py-1 rounded-md bg-sv-elevated border border-sv-border">
          <label className="flex items-center gap-1.5 sm:gap-2 cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={playChords}
              onChange={(e) => setPlayChords(e.target.checked)}
              className="w-4 h-4 rounded border-sv-border text-sv-cyan focus:ring-sv-cyan/50"
            />
            <span className="text-xs text-sv-text">Play Chords</span>
          </label>
          <label className="flex items-center gap-1.5 sm:gap-2 cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={expressivePlayback}
              onChange={(e) => setExpressivePlayback(e.target.checked)}
              className="w-4 h-4 rounded border-sv-border text-sv-cyan focus:ring-sv-cyan/50"
            />
            <span className="text-xs text-sv-text">Expressive</span>
          </label>
          <label className="flex items-center gap-1.5 sm:gap-2 cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={metronomeEnabled}
              onChange={(e) => setMetronomeEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-sv-border text-sv-cyan focus:ring-sv-cyan/50"
            />
            <span className="text-xs text-sv-text inline-flex items-center gap-1" title="Add click track during playback">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 3 6 10v10h12V10l-6-7zm0 3.2L15.4 10H8.6L12 6.2zM9 12h6v6H9v-6z" />
              </svg>
              Metronome
            </span>
          </label>
          <label className="flex items-center gap-1.5 sm:gap-2 cursor-pointer whitespace-nowrap">
            <input
              type="checkbox"
              checked={countInEnabled}
              onChange={(e) => setCountInEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-sv-border text-sv-cyan focus:ring-sv-cyan/50"
            />
            <span className="text-xs text-sv-text" title="Play clicks before playback starts">Count in</span>
          </label>
          <select
            value={countInBars}
            onChange={(e) => setCountInBars((Number(e.target.value) === 2 ? 2 : 1))}
            disabled={!countInEnabled}
            className="sv-select w-16 sm:w-20 text-xs disabled:opacity-50 whitespace-nowrap"
            title="Count-in length"
          >
            <option value={1}>1b</option>
            <option value={2}>2b</option>
          </select>
        </div>
      )}
      {!isGregorianChant && <MidiInputPanel isReadOnly={isReadOnly} />}
    </div>
  );
};
