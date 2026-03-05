import { useScoreStore } from '../../app/store/scoreStore';
import { usePlaybackStore } from '../../app/store/playbackStore';

export const StaffVolumeControls = () => {
  const composition    = useScoreStore((state) => state.composition);
  const staffVolumes   = usePlaybackStore((state) => state.staffVolumes);
  const staffMuted     = usePlaybackStore((state) => state.staffMuted);
  const setStaffVolume = usePlaybackStore((state) => state.setStaffVolume);
  const setStaffMuted  = usePlaybackStore((state) => state.setStaffMuted);

  if (!composition) return null;

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Volume</span>
      {composition.staves.map((staff, index) => {
        const volume     = staffVolumes[index] ?? 100;
        const muted      = staffMuted[index] ?? false;
        const displayName = staff.name || `S${index + 1}`;

        return (
          <div key={index} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-sv-elevated border border-sv-border">
            <span className="text-xs text-sv-text-muted min-w-[28px] truncate" title={displayName}>
              {displayName}
            </span>

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

            {/* Slider */}
            <input
              type="range"
              min="0" max="100"
              value={muted ? 0 : volume}
              disabled={muted}
              onChange={(e) => {
                const v = Number(e.target.value);
                setStaffVolume(index, v);
                if (muted && v > 0) setStaffMuted(index, false);
              }}
              className="w-16 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: muted ? undefined :
                  `linear-gradient(to right, var(--sv-cyan) ${volume}%, var(--sv-border) ${volume}%)`
              }}
            />
            <span className="text-xs text-sv-text-dim min-w-[28px] text-right">
              {muted ? '0%' : `${volume}%`}
            </span>
          </div>
        );
      })}
    </div>
  );
};
