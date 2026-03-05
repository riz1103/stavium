import { NoteDuration } from '../types/music';

/**
 * Converts a note duration to beats (assuming 4/4 time)
 */
export const durationToBeats = (duration: NoteDuration): number => {
  const durationMap: Record<NoteDuration, number> = {
    'whole': 4,
    'half': 2,
    'quarter': 1,
    'eighth': 0.5,
    'sixteenth': 0.25,
    'thirty-second': 0.125,
    'dotted-whole': 6,
    'dotted-half': 3,
    'dotted-quarter': 1.5,
    'dotted-eighth': 0.75,
    'dotted-sixteenth': 0.375,
  };

  return durationMap[duration] || 1;
};

/**
 * Converts beats to seconds based on tempo (BPM)
 */
export const beatsToSeconds = (beats: number, tempo: number): number => {
  return (beats * 60) / tempo;
};

/**
 * Gets the VexFlow duration string
 */
export const durationToVexFlow = (duration: NoteDuration): string => {
  const vexFlowMap: Record<NoteDuration, string> = {
    'whole': 'w',
    'half': 'h',
    'quarter': 'q',
    'eighth': '8',
    'sixteenth': '16',
    'thirty-second': '32',
    'dotted-whole': 'wd',
    'dotted-half': 'hd',
    'dotted-quarter': 'qd',
    'dotted-eighth': '8d',
    'dotted-sixteenth': '16d',
  };

  return vexFlowMap[duration] || 'q';
};

/**
 * Gets the Tone.js duration string
 */
export const durationToTone = (duration: NoteDuration, tempo: number = 120): string => {
  const beats = durationToBeats(duration);
  // Tone.js uses "4n" for quarter notes, "8n" for eighth notes, etc.
  // For now, we'll use time-based durations
  const seconds = beatsToSeconds(beats, tempo);
  return `${seconds}`;
};
