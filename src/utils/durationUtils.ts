import { NoteDuration } from '../types/music';

/**
 * Converts a note duration to beats (assuming 4/4 time)
 */
export const durationToBeats = (duration: NoteDuration): number => {
  const baseMap: Record<'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth' | 'thirty-second', number> = {
    whole: 4,
    half: 2,
    quarter: 1,
    eighth: 0.5,
    sixteenth: 0.25,
    'thirty-second': 0.125,
  };

  const tuplets: Record<string, number> = {
    triplet: 2 / 3,
    quintuplet: 4 / 5,
    sextuplet: 4 / 6,
    septuplet: 4 / 7,
  };

  const tupleMatch = duration.match(/^(triplet|quintuplet|sextuplet|septuplet)-(.+)$/);
  if (tupleMatch) {
    const [, kind, rawBase] = tupleMatch;
    const base = rawBase as keyof typeof baseMap;
    const baseBeats = baseMap[base];
    if (baseBeats !== undefined) return baseBeats * tuplets[kind];
  }

  if (duration.startsWith('dotted-')) {
    const base = duration.replace('dotted-', '') as keyof typeof baseMap;
    const baseBeats = baseMap[base];
    if (baseBeats !== undefined) return baseBeats * 1.5;
  }

  const base = duration as keyof typeof baseMap;
  return baseMap[base] ?? 1;
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
  const baseMap: Record<'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth' | 'thirty-second', string> = {
    whole: 'w',
    half: 'h',
    quarter: 'q',
    eighth: '8',
    sixteenth: '16',
    'thirty-second': '32',
  };

  const tupleMatch = duration.match(/^(triplet|quintuplet|sextuplet|septuplet)-(.+)$/);
  if (tupleMatch) {
    const base = tupleMatch[2] as keyof typeof baseMap;
    return baseMap[base] ?? 'q';
  }

  if (duration.startsWith('dotted-')) {
    const base = duration.replace('dotted-', '') as keyof typeof baseMap;
    const vfBase = baseMap[base] ?? 'q';
    return `${vfBase}d`;
  }

  return baseMap[duration as keyof typeof baseMap] ?? 'q';
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
