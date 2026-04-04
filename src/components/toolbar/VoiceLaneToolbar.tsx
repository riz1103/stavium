import { useMemo } from 'react';
import { useScoreStore } from '../../app/store/scoreStore';
import { usePlaybackStore } from '../../app/store/playbackStore';
import { NoteDuration } from '../../types/music';

const VOICE_LABELS = ['V1', 'V2', 'V3', 'V4'] as const;

const durationLabel = (duration: NoteDuration): string =>
  duration
    .replace('dotted-', 'dot ')
    .replace('triplet-', '3:')
    .replace('quintuplet-', '5:')
    .replace('sextuplet-', '6:')
    .replace('septuplet-', '7:')
    .replace('thirty-second', '32nd');

export const VoiceLaneToolbar = () => {
  const composition = useScoreStore((s) => s.composition);
  const selectedStaffIndex = useScoreStore((s) => s.selectedStaffIndex ?? 0);
  const selectedVoiceIndex = useScoreStore((s) => s.selectedVoiceIndex);
  const setSelectedVoiceIndex = useScoreStore((s) => s.setSelectedVoiceIndex);
  const voiceVisibility = useScoreStore((s) => s.voiceVisibility);
  const toggleVoiceVisibility = useScoreStore((s) => s.toggleVoiceVisibility);
  const setAllVoicesVisible = useScoreStore((s) => s.setAllVoicesVisible);
  const voiceDurations = useScoreStore((s) => s.voiceDurations);
  const voiceRestDurations = useScoreStore((s) => s.voiceRestDurations);
  const voiceMuted = usePlaybackStore((s) => s.voiceMuted);
  const voiceSoloed = usePlaybackStore((s) => s.voiceSoloed);
  const setVoiceMuted = usePlaybackStore((s) => s.setVoiceMuted);
  const setVoiceSoloed = usePlaybackStore((s) => s.setVoiceSoloed);

  const voiceNoteCounts = useMemo(() => {
    if (!composition) return [0, 0, 0, 0];
    const counts = [0, 0, 0, 0];
    composition.staves.forEach((staff) => {
      staff.measures.forEach((measure) => {
        for (let lane = 0; lane < 4; lane++) {
          const voice = measure.voices[lane];
          if (!voice) continue;
          counts[lane] += voice.notes.filter((el) => 'pitch' in el).length;
        }
      });
    });
    return counts;
  }, [composition]);

  return (
    <div className="sv-toolbar">
      <span className="sv-toolbar-label">Voices</span>
      <div className="flex flex-wrap gap-1">
        {VOICE_LABELS.map((label, laneIndex) => {
          const active = selectedVoiceIndex === laneIndex;
          const visible = voiceVisibility[laneIndex] ?? true;
          const rhythmPreview = voiceRestDurations[laneIndex]
            ? `R ${durationLabel(voiceRestDurations[laneIndex] as NoteDuration)}`
            : durationLabel(voiceDurations[laneIndex] ?? 'quarter');
          const noteCount = voiceNoteCounts[laneIndex] ?? 0;
          const laneKey = `${selectedStaffIndex}:${laneIndex}`;
          const laneMuted = voiceMuted[laneKey] ?? false;
          const laneSoloed = voiceSoloed[laneKey] ?? false;
          return (
            <div
              key={label}
              className={`flex items-center gap-1 rounded-md border px-1 py-0.5 ${
                active ? 'border-sv-cyan/40 bg-sv-cyan/10' : 'border-sv-border bg-sv-card/40'
              }`}
            >
              <button
                onClick={() => setSelectedVoiceIndex(laneIndex)}
                className={active ? 'sv-btn-active text-xs' : 'sv-btn-ghost text-xs'}
                title={`${label} lane · ${rhythmPreview} · ${noteCount} notes`}
              >
                {label}
              </button>
              <button
                onClick={() => toggleVoiceVisibility(laneIndex)}
                className={visible ? 'sv-btn-ghost text-xs' : 'sv-btn-danger text-xs'}
                title={visible ? `Hide ${label}` : `Show ${label}`}
              >
                {visible ? '👁' : '🚫'}
              </button>
              <button
                onClick={() => setVoiceMuted(selectedStaffIndex, laneIndex, !laneMuted)}
                className={`w-6 h-6 flex items-center justify-center rounded text-xs transition-colors ${
                  laneMuted ? 'bg-rose-500/30 text-rose-400' : 'text-sv-text-muted hover:text-sv-text'
                }`}
                title={laneMuted ? `Unmute ${label}` : `Mute ${label}`}
              >
                {laneMuted ? (
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                  </svg>
                )}
              </button>
              <button
                onClick={() => setVoiceSoloed(selectedStaffIndex, laneIndex, !laneSoloed)}
                className={laneSoloed ? 'sv-btn-success text-xs' : 'sv-btn-ghost text-xs'}
                title={laneSoloed ? `Unsolo ${label}` : `Solo ${label}`}
              >
                S
              </button>
              <span className="text-[10px] text-sv-text-dim px-0.5">{rhythmPreview}</span>
            </div>
          );
        })}
      </div>
      <button
        onClick={setAllVoicesVisible}
        className="sv-btn-ghost text-xs"
        title="Show all voice lanes"
      >
        Show all
      </button>
    </div>
  );
};
