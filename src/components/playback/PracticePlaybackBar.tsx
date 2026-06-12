import { VoiceVolumeControls } from './VoiceVolumeControls';

type PracticePlaybackBarProps = {
  isGregorianChant: boolean;
  totalMeasures: number;
  measureOptions: number[];
  playbackStartMeasure: number | null;
  playbackEndMeasure: number | null;
  setPlaybackRange: (start: number | null, end: number | null) => void;
  isLooping: boolean;
  setLooping: (looping: boolean) => void;
  isPlaying: boolean;
  isPaused: boolean;
  isLoading: boolean;
  hasNotes: boolean | undefined;
  playbackState: string;
  effectiveTempo: number;
  playbackTempo: number | null;
  compositionTempo: number;
  setPlaybackTempo: (tempo: number | null) => void;
  metronomeEnabled: boolean;
  setMetronomeEnabled: (enabled: boolean) => void;
  countInEnabled: boolean;
  setCountInEnabled: (enabled: boolean) => void;
  countInBars: 1 | 2;
  setCountInBars: (bars: 1 | 2) => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onReplay: () => void;
  onExitPractice: () => void;
};

export const PracticePlaybackBar = ({
  isGregorianChant,
  totalMeasures,
  measureOptions,
  playbackStartMeasure,
  playbackEndMeasure,
  setPlaybackRange,
  isLooping,
  setLooping,
  isPlaying,
  isPaused,
  isLoading,
  hasNotes,
  playbackState,
  effectiveTempo,
  playbackTempo,
  compositionTempo,
  setPlaybackTempo,
  metronomeEnabled,
  setMetronomeEnabled,
  countInEnabled,
  setCountInEnabled,
  countInBars,
  setCountInBars,
  onPlay,
  onPause,
  onStop,
  onReplay,
  onExitPractice,
}: PracticePlaybackBarProps) => {
  const handleTempoChange = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(20, Math.min(300, Math.round(n)));
    setPlaybackTempo(clamped === compositionTempo ? null : clamped);
  };

  return (
    <div className="flex flex-col gap-1 px-2 py-1.5 sm:px-3 sm:py-2">
      {/* Row 1: transport + range + tempo + practice helpers */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          onClick={onExitPractice}
          className="flex-shrink-0 px-2 py-1 rounded-md text-[10px] sm:text-xs font-medium border border-sv-cyan/50 bg-sv-cyan/15 text-sv-cyan hover:bg-sv-cyan/25 transition-colors"
          title="Exit practice mode and show full playback controls"
        >
          Practice
        </button>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            data-tour-id="tour-play-button"
            onClick={onPlay}
            disabled={!hasNotes || isPlaying || isLoading}
            className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-150 ${
              !hasNotes || isPlaying || isLoading
                ? 'bg-sv-elevated text-sv-text-dim cursor-not-allowed'
                : 'bg-sv-cyan text-sv-bg hover:bg-sv-cyan-dim shadow-glow-sm'
            }`}
            title={!hasNotes ? 'Add notes first' : isPaused ? 'Resume' : 'Play'}
          >
            {isLoading ? (
              <span className="w-3.5 h-3.5 border-2 border-sv-bg border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={onPause}
            disabled={!isPlaying}
            className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-150 ${
              isPlaying
                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40 hover:bg-amber-500/30'
                : 'bg-sv-elevated text-sv-text-dim cursor-not-allowed'
            }`}
            title="Pause"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onStop}
            disabled={playbackState === 'stopped'}
            className={`flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-150 ${
              playbackState !== 'stopped'
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 hover:bg-rose-500/30'
                : 'bg-sv-elevated text-sv-text-dim cursor-not-allowed'
            }`}
            title="Stop"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 6h12v12H6z" />
            </svg>
          </button>
        </div>

        {!isGregorianChant && totalMeasures > 0 && (
          <div className="flex items-center gap-1 px-2 py-0.5 bg-sv-elevated rounded-md border border-sv-border">
            <select
              value={playbackStartMeasure ?? ''}
              onChange={(e) =>
                setPlaybackRange(
                  e.target.value ? Number(e.target.value) - 1 : null,
                  playbackEndMeasure
                )
              }
              className="sv-select w-12 text-[10px] sm:text-xs"
              disabled={isPlaying}
              aria-label="Start measure"
            >
              <option value="">Start</option>
              {measureOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-sv-text-dim">–</span>
            <select
              value={playbackEndMeasure !== null ? playbackEndMeasure + 1 : ''}
              onChange={(e) =>
                setPlaybackRange(
                  playbackStartMeasure,
                  e.target.value ? Number(e.target.value) - 1 : null
                )
              }
              className="sv-select w-12 text-[10px] sm:text-xs"
              disabled={isPlaying}
              aria-label="End measure"
            >
              <option value="">End</option>
              {measureOptions.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            {(playbackStartMeasure !== null || playbackEndMeasure !== null) && (
              <button
                type="button"
                onClick={onReplay}
                disabled={isPlaying || isLoading}
                className="flex items-center justify-center w-6 h-6 rounded text-sv-cyan hover:bg-sv-cyan/15 transition-colors disabled:opacity-50"
                title="Replay from start measure"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
                </svg>
              </button>
            )}
            <label className="flex items-center gap-1 cursor-pointer ml-0.5">
              <input
                type="checkbox"
                checked={isLooping}
                onChange={(e) => setLooping(e.target.checked)}
                className="w-3 h-3 rounded border-sv-border text-sv-cyan focus:ring-sv-cyan/50"
              />
              <span className="text-[10px] text-sv-text">Loop</span>
            </label>
          </div>
        )}

        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-sv-border bg-sv-elevated/60">
          <input
            type="number"
            min={20}
            max={300}
            value={effectiveTempo}
            onChange={(e) => handleTempoChange(e.target.value)}
            className="w-10 sm:w-12 bg-transparent text-xs text-sv-text text-center focus:outline-none"
            title="Practice tempo (does not change the saved score unless you edit Tempo in Score Settings)"
            aria-label="Tempo BPM"
          />
          <span className="text-[10px] text-sv-text-dim">BPM</span>
          {playbackTempo !== null && playbackTempo !== compositionTempo && (
            <button
              type="button"
              onClick={() => setPlaybackTempo(null)}
              className="text-[10px] text-sv-cyan hover:underline"
              title="Reset to score tempo"
            >
              Reset
            </button>
          )}
        </div>

        {!isGregorianChant && (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setMetronomeEnabled(!metronomeEnabled)}
              className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                metronomeEnabled
                  ? 'border-sv-cyan/50 bg-sv-cyan/15 text-sv-cyan'
                  : 'border-sv-border text-sv-text-dim hover:text-sv-text'
              }`}
              title="Metronome click track"
            >
              Metro
            </button>
            <button
              type="button"
              onClick={() => setCountInEnabled(!countInEnabled)}
              className={`px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                countInEnabled
                  ? 'border-sv-cyan/50 bg-sv-cyan/15 text-sv-cyan'
                  : 'border-sv-border text-sv-text-dim hover:text-sv-text'
              }`}
              title="Count-in before playback"
            >
              Count-in
            </button>
            {countInEnabled && (
              <select
                value={countInBars}
                onChange={(e) => setCountInBars(Number(e.target.value) === 2 ? 2 : 1)}
                className="sv-select w-10 text-[10px]"
                title="Count-in length"
              >
                <option value={1}>1b</option>
                <option value={2}>2b</option>
              </select>
            )}
          </div>
        )}

        {isPlaying && (
          <span className="flex items-center gap-1 text-sv-cyan text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-sv-cyan animate-pulse" />
            Playing
          </span>
        )}
        {isPaused && (
          <span className="flex items-center gap-1 text-amber-400 text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            Paused
          </span>
        )}
      </div>

      {/* Row 2: per-voice volume (only lanes with notes) */}
      {!isGregorianChant && <VoiceVolumeControls compact />}
    </div>
  );
};
