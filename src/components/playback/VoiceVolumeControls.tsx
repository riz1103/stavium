import { useMemo } from 'react';
import { useScoreStore } from '../../app/store/scoreStore';
import { usePlaybackStore } from '../../app/store/playbackStore';

const VOICE_LABELS = ['V1', 'V2', 'V3', 'V4'] as const;

type VoiceLaneRef = {
  staffIndex: number;
  voiceIndex: number;
  label: string;
  noteCount: number;
};

export const VoiceVolumeControls = ({ compact = false }: { compact?: boolean }) => {
  const composition = useScoreStore((s) => s.composition);
  const voiceVolumes = usePlaybackStore((s) => s.voiceVolumes);
  const voiceMuted = usePlaybackStore((s) => s.voiceMuted);
  const voiceSoloed = usePlaybackStore((s) => s.voiceSoloed);
  const setVoiceVolume = usePlaybackStore((s) => s.setVoiceVolume);
  const setVoiceMuted = usePlaybackStore((s) => s.setVoiceMuted);
  const setVoiceSoloed = usePlaybackStore((s) => s.setVoiceSoloed);
  const clearVoiceSoloed = usePlaybackStore((s) => s.clearVoiceSoloed);
  const isVoiceEffectivelyMuted = usePlaybackStore((s) => s.isVoiceEffectivelyMuted);

  const lanes = useMemo((): VoiceLaneRef[] => {
    if (!composition) return [];
    const multiStaff = composition.staves.length > 1;
    const result: VoiceLaneRef[] = [];
    composition.staves.forEach((staff, staffIndex) => {
      const counts = [0, 0, 0, 0];
      staff.measures.forEach((measure) => {
        for (let lane = 0; lane < 4; lane++) {
          const voice = measure.voices[lane];
          if (!voice) continue;
          counts[lane] += voice.notes.filter((el) => 'pitch' in el).length;
        }
      });
      const staffName = staff.name || `S${staffIndex + 1}`;
      counts.forEach((noteCount, voiceIndex) => {
        if (noteCount === 0) return;
        const voiceLabel = VOICE_LABELS[voiceIndex];
        result.push({
          staffIndex,
          voiceIndex,
          noteCount,
          label: multiStaff ? `${staffName} ${voiceLabel}` : voiceLabel,
        });
      });
    });
    return result;
  }, [composition]);

  const anySoloed = useMemo(
    () => Object.values(voiceSoloed).some(Boolean),
    [voiceSoloed]
  );

  if (!composition || lanes.length === 0) return null;

  const sliderWidth = compact ? 'w-14 sm:w-20' : 'w-16';

  return (
    <div className={`flex items-center gap-1.5 ${compact ? 'min-w-0 flex-1' : ''}`}>
      {compact && (
        <span className="text-[10px] uppercase tracking-wide text-sv-text-dim flex-shrink-0">Voices</span>
      )}
      {anySoloed && (
        <button
          type="button"
          onClick={() => clearVoiceSoloed()}
          className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] border border-sv-cyan/40 text-sv-cyan bg-sv-cyan/10 hover:bg-sv-cyan/20 transition-colors"
          title="Clear all soloed voice lanes"
        >
          Clear Solo
        </button>
      )}
      <div className={`flex items-center gap-1.5 ${compact ? 'overflow-x-auto min-w-0 flex-1 pb-0.5' : 'flex-wrap'}`}>
        {lanes.map(({ staffIndex, voiceIndex, label }) => {
          const key = `${staffIndex}:${voiceIndex}`;
          const volume = voiceVolumes[key] ?? 100;
          const muted = voiceMuted[key] ?? false;
          const soloed = voiceSoloed[key] ?? false;
          const dimmedBySolo = isVoiceEffectivelyMuted(staffIndex, voiceIndex) && !muted;

          return (
            <div
              key={key}
              className={`flex items-center gap-1 flex-shrink-0 rounded-md border px-1.5 py-0.5 ${
                soloed ? 'border-sv-cyan/40 bg-sv-cyan/10' : 'border-sv-border bg-sv-elevated/80'
              }`}
            >
              <span className="text-[10px] font-medium text-sv-text-muted min-w-[22px]" title={label}>
                {label}
              </span>
              <button
                type="button"
                onClick={() => setVoiceMuted(staffIndex, voiceIndex, !muted)}
                className={`w-5 h-5 flex items-center justify-center rounded text-[10px] transition-colors ${
                  muted ? 'bg-rose-500/30 text-rose-400' : 'text-sv-text-dim hover:text-sv-text'
                }`}
                title={muted ? `Unmute ${label}` : `Mute ${label}`}
              >
                M
              </button>
              <button
                type="button"
                onClick={() => setVoiceSoloed(staffIndex, voiceIndex, !soloed)}
                className={`w-5 h-5 flex items-center justify-center rounded text-[10px] font-semibold transition-colors border ${
                  soloed
                    ? 'bg-sv-cyan/25 text-sv-cyan border-sv-cyan/50'
                    : dimmedBySolo
                    ? 'text-sv-text-dim border-sv-border/50'
                    : 'text-sv-text-dim border-transparent hover:text-sv-text'
                }`}
                title={soloed ? `Unsolo ${label}` : `Solo ${label}`}
              >
                S
              </button>
              <input
                type="range"
                min="0"
                max="100"
                value={muted || dimmedBySolo ? 0 : volume}
                disabled={muted || dimmedBySolo}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setVoiceVolume(staffIndex, voiceIndex, v);
                  if (muted && v > 0) setVoiceMuted(staffIndex, voiceIndex, false);
                }}
                className={`${sliderWidth} disabled:opacity-40 disabled:cursor-not-allowed h-1`}
                style={{
                  background:
                    muted || dimmedBySolo
                      ? undefined
                      : `linear-gradient(to right, var(--sv-cyan) ${volume}%, var(--sv-border) ${volume}%)`,
                }}
                aria-label={`${label} volume`}
              />
              {!compact && (
                <span className="text-[10px] text-sv-text-dim min-w-[24px] text-right">
                  {muted || dimmedBySolo ? '0%' : `${volume}%`}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
