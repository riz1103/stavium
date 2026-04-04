import { useScoreStore } from '../../app/store/scoreStore';
import { usePlaybackStore } from '../../app/store/playbackStore';

export const StaffVolumeControls = () => {
  const composition    = useScoreStore((state) => state.composition);
  const setStaffHidden = useScoreStore((state) => state.setStaffHidden);
  const staffVolumes   = usePlaybackStore((state) => state.staffVolumes);
  const staffMuted     = usePlaybackStore((state) => state.staffMuted);
  const staffSoloed    = usePlaybackStore((state) => state.staffSoloed);
  const setStaffVolume = usePlaybackStore((state) => state.setStaffVolume);
  const setStaffMuted  = usePlaybackStore((state) => state.setStaffMuted);
  const setStaffSoloed = usePlaybackStore((state) => state.setStaffSoloed);
  const clearStaffSoloed = usePlaybackStore((state) => state.clearStaffSoloed);
  const clearVoiceSoloed = usePlaybackStore((state) => state.clearVoiceSoloed);
  const hasAnySoloedStaff = usePlaybackStore((state) => state.hasAnySoloedStaff);

  if (!composition) return null;
  const anySoloed = hasAnySoloedStaff();

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Volume</span>
      {anySoloed && (
        <button
          onClick={() => {
            clearStaffSoloed();
            clearVoiceSoloed();
          }}
          className="px-2 py-1 rounded-md text-xs border border-sv-cyan/40 text-sv-cyan bg-sv-cyan/10 hover:bg-sv-cyan/20 transition-colors"
          title="Clear all soloed staves and voice lanes"
        >
          Clear Solo
        </button>
      )}
      {composition.staves.map((staff, index) => {
        const volume      = staffVolumes[index] ?? 100;
        const muted       = staffMuted[index] ?? false;
        const soloed      = staffSoloed[index] ?? false;
        const dimmedBySolo = anySoloed && !soloed;
        const hidden      = staff.hidden ?? false;
        const displayName = staff.name || `S${index + 1}`;

        return (
          <div
            key={index}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md border transition-opacity ${
              hidden
                ? 'bg-sv-elevated/50 border-sv-border/50 opacity-50'
                : 'bg-sv-elevated border-sv-border'
            }`}
          >
            <span className="text-xs text-sv-text-muted min-w-[28px] truncate" title={displayName}>
              {displayName}
            </span>

            {/* Hide / Show */}
            <button
              onClick={() => setStaffHidden(index, !hidden)}
              title={hidden ? 'Show in score' : 'Hide from score'}
              className={`w-6 h-6 flex items-center justify-center rounded text-xs transition-colors ${
                hidden
                  ? 'bg-violet-500/30 text-violet-400'
                  : 'text-sv-text-muted hover:text-sv-text'
              }`}
            >
              {hidden ? (
                /* eye-off */
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46A11.804 11.804 0 0 0 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>
                </svg>
              ) : (
                /* eye */
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
                </svg>
              )}
            </button>

            {/* Mute */}
            <button
              onClick={() => setStaffMuted(index, !muted)}
              title={muted ? 'Unmute' : 'Mute'}
              className={`w-6 h-6 flex items-center justify-center rounded text-xs transition-colors ${
                muted ? 'bg-rose-500/30 text-rose-400' : 'text-sv-text-muted hover:text-sv-text'
              }`}
            >
              {muted ? (
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                </svg>
              )}
            </button>

            {/* Solo */}
            <button
              onClick={() => setStaffSoloed(index, !soloed)}
              title={soloed ? 'Unsolo' : 'Solo'}
              className={`w-6 h-6 flex items-center justify-center rounded text-[10px] font-semibold transition-colors border ${
                soloed
                  ? 'bg-sv-cyan/25 text-sv-cyan border-sv-cyan/50'
                  : dimmedBySolo
                  ? 'text-sv-text-dim border-sv-border/50'
                  : 'text-sv-text-muted border-sv-border hover:text-sv-text hover:border-sv-border-lt'
              }`}
            >
              S
            </button>

            {/* Slider */}
            <input
              type="range"
              min="0" max="100"
              value={muted || dimmedBySolo ? 0 : volume}
              disabled={muted || dimmedBySolo}
              onChange={(e) => {
                const v = Number(e.target.value);
                setStaffVolume(index, v);
                if (muted && v > 0) setStaffMuted(index, false);
              }}
              className="w-16 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: muted || dimmedBySolo ? undefined :
                  `linear-gradient(to right, var(--sv-cyan) ${volume}%, var(--sv-border) ${volume}%)`
              }}
            />
            <span className="text-xs text-sv-text-dim min-w-[28px] text-right">
              {muted || dimmedBySolo ? '0%' : `${volume}%`}
            </span>
          </div>
        );
      })}
    </div>
  );
};
