import { useEffect, useRef, useState } from 'react';
import { useScoreStore } from '../../app/store/scoreStore';
import { usePlaybackStore } from '../../app/store/playbackStore';
import { ToneScheduler } from '../../music/playback/toneScheduler';

export const PlaybackControls = () => {
  const composition = useScoreStore((state) => state.composition);
  const playbackState = usePlaybackStore((state) => state.state);
  const setPlaybackState = usePlaybackStore((state) => state.setState);
  const getEffectiveTempo = usePlaybackStore((state) => state.getEffectiveTempo);
  const playbackStartMeasure = usePlaybackStore((state) => state.playbackStartMeasure);
  const playbackEndMeasure = usePlaybackStore((state) => state.playbackEndMeasure);
  const setPlaybackRange = usePlaybackStore((state) => state.setPlaybackRange);
  const schedulerRef = useRef<ToneScheduler | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    schedulerRef.current = new ToneScheduler();
    return () => { schedulerRef.current?.dispose(); schedulerRef.current = null; };
  }, []);

  // Preload instruments when composition is loaded (background, non-blocking)
  useEffect(() => {
    if (!composition || !schedulerRef.current) return;
    
    // Preload instruments in the background (don't await, let it happen async)
    schedulerRef.current.preloadInstruments(composition, true).catch((err) => {
      // Silently handle errors - preloading is best-effort
      console.debug('Instrument preloading failed:', err);
    });
  }, [composition]);

  const handlePlay = async () => {
    if (!composition || !schedulerRef.current) return;
    if (playbackState === 'paused') {
      schedulerRef.current.resume();
      setPlaybackState('playing');
      return;
    }
    setIsLoading(true);
    try {
      const effectiveTempo = getEffectiveTempo(composition.tempo);
      await schedulerRef.current.playComposition(
        composition, 
        effectiveTempo,
        playbackStartMeasure,
        playbackEndMeasure
      );
      setPlaybackState('playing');
    } catch (err) {
      console.error('Playback error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReplay = async () => {
    if (!composition || !schedulerRef.current) return;
    // Stop current playback first
    schedulerRef.current.stop();
    setPlaybackState('stopped');
    // Small delay to ensure stop completes
    setTimeout(() => {
      handlePlay();
    }, 100);
  };

  const handlePause = () => { schedulerRef.current?.pause(); setPlaybackState('paused'); };
  const handleStop  = () => { schedulerRef.current?.stop();  setPlaybackState('stopped'); };

  const hasNotes = composition?.staves.some((s) =>
    s.measures.some((m) => m.voices.some((v) => v.notes.length > 0))
  );
  const getEffectiveInstrument = usePlaybackStore((state) => state.getEffectiveInstrument);
  const currentInstrument = composition
    ? getEffectiveInstrument(0, composition.staves[0]?.instrument ?? 'piano')
    : 'piano';
  const isPlaying = playbackState === 'playing';
  const isPaused  = playbackState === 'paused';
  
  // Get total number of measures
  const totalMeasures = composition?.staves[0]?.measures.length ?? 0;
  const measureOptions = Array.from({ length: totalMeasures }, (_, i) => i + 1);

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 flex-wrap">
      {/* Transport controls */}
      <div className="flex items-center gap-1">
        {/* Play / Resume */}
        <button
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
      {composition && totalMeasures > 0 && (
        <div className="flex items-center gap-2 ml-2 px-3 py-1.5 bg-sv-elevated rounded-lg border border-sv-border">
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
        </div>
      )}

      {/* Status / Info */}
      {composition && (
        <div className="flex items-center gap-2 ml-2 text-sm text-sv-text-muted">
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
    </div>
  );
};
