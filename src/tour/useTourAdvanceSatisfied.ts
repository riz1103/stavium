import { useMemo } from 'react';
import { useScoreStore } from '../app/store/scoreStore';
import { usePlaybackStore } from '../app/store/playbackStore';
import type { EditorTourStep } from './editorTourSteps';
import type { NoteDuration, Note } from '../types/music';

function baseNoteDuration(d: NoteDuration): NoteDuration {
  if (d.startsWith('dotted-')) {
    return d.replace('dotted-', '') as NoteDuration;
  }
  const m = d.match(/^(triplet|quintuplet|sextuplet|septuplet)-/);
  return m ? (d.replace(/^(triplet|quintuplet|sextuplet|septuplet)-/, '') as NoteDuration) : d;
}

function firstNoteInMeasure2(
  composition: NonNullable<ReturnType<typeof useScoreStore.getState>['composition']>
): Note | null {
  const notes = composition.staves[0]?.measures[1]?.voices[0]?.notes ?? [];
  for (const el of notes) {
    if ('pitch' in el) return el;
  }
  return null;
}

/**
 * Whether the current tour step's hands-on task is complete.
 * @param pitchBaseline — pitch captured when entering the drag step (parent sets via layout effect)
 */
export function useTourAdvanceSatisfied(
  step: EditorTourStep | undefined,
  isTourMode: boolean,
  pitchBaseline: string | null
): boolean {
  const composition = useScoreStore((s) => s.composition);
  const selectedDuration = useScoreStore((s) => s.selectedDuration);
  const playbackState = usePlaybackStore((s) => s.state);

  return useMemo(() => {
    if (!isTourMode || !step) return true;
    const w = step.waitFor ?? 'manual';
    if (w === 'manual') return true;

    switch (w) {
      case 'select-quarter-duration':
        return baseNoteDuration(selectedDuration) === 'quarter';
      case 'place-note-measure-2': {
        if (!composition) return false;
        return !!firstNoteInMeasure2(composition);
      }
      case 'change-selected-note-pitch': {
        if (!composition || pitchBaseline === null) return false;
        const note = firstNoteInMeasure2(composition);
        return !!note && note.pitch !== pitchBaseline;
      }
      case 'playback-started':
        return playbackState === 'playing';
      default:
        return true;
    }
  }, [isTourMode, step, composition, selectedDuration, playbackState, pitchBaseline]);
}
