import { useEffect, useRef, useState } from 'react';
import { useScoreStore } from '../../app/store/scoreStore';
import { usePlaybackStore } from '../../app/store/playbackStore';
import { ToneScheduler } from '../../music/playback/toneScheduler';

export const PlaybackControls = () => {
  const composition = useScoreStore((state) => state.composition);
  const playbackState = usePlaybackStore((state) => state.state);
  const setPlaybackState = usePlaybackStore((state) => state.setState);
  const schedulerRef = useRef<ToneScheduler | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    schedulerRef.current = new ToneScheduler();
    return () => { schedulerRef.current?.dispose(); schedulerRef.current = null; };
  }, []);

  const handlePlay = async () => {
    if (!composition || !schedulerRef.current) return;
    if (playbackState === 'paused') {
      schedulerRef.current.resume();
      setPlaybackState('playing');
      return;
    }
    setIsLoading(true);
    try {
      await schedulerRef.current.playComposition(composition);
      setPlaybackState('playing');
    } catch (err) {
      console.error('Playback error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePause = () => { schedulerRef.current?.pause(); setPlaybackState('paused'); };
  const handleStop  = () => { schedulerRef.current?.stop();  setPlaybackState('stopped'); };

  const hasNotes = composition?.staves.some((s) =>
    s.measures.some((m) => m.voices.some((v) => v.notes.length > 0))
  );
  const currentInstrument = composition?.staves[0]?.instrument ?? 'piano';
  const isPlaying = playbackState === 'playing';
  const isPaused  = playbackState === 'paused';

  return (
    <div className="flex items-center gap-2 px-4 py-2.5">
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
            {composition.tempo} <span className="text-xs text-sv-text-dim">BPM</span>
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
