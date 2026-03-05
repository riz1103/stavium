import { Note as TonalNote, Chord } from 'tonal';
import { Note, Pitch } from '../../types/music';
import { pitchToMidi, midiToPitch } from '../../utils/noteUtils';

export interface DetectedChord {
  name: string;
  root: string;
  quality: string;
  notes: Pitch[];
}

/**
 * Detects chords from a set of notes
 */
export const detectChord = (notes: Note[]): DetectedChord | null => {
  if (notes.length < 2) return null;

  // Convert pitches to note names (without octave)
  const noteNames = notes
    .map((note) => {
      const match = note.pitch.match(/^([A-G])([#b]?)/);
      if (!match) return null;
      return match[1] + (match[2] || '');
    })
    .filter((name): name is string => name !== null);

  if (noteNames.length < 2) return null;

  // Try to detect chord using Tonal.js
  const uniqueNotes = [...new Set(noteNames)];
  const chordName = Chord.detect(uniqueNotes);

  if (chordName && chordName.length > 0) {
    const detected = chordName[0];
    const chord = Chord.get(detected);

    return {
      name: detected,
      root: chord.tonic || '',
      quality: chord.aliases?.[0] || '',
      notes: notes.map((n) => n.pitch),
    };
  }

  return null;
};

/**
 * Gets the chord symbol for a set of notes
 */
export const getChordSymbol = (notes: Note[]): string | null => {
  const chord = detectChord(notes);
  return chord ? chord.name : null;
};

/**
 * Analyzes harmony in a measure
 */
export const analyzeHarmony = (notes: Note[]): {
  chords: DetectedChord[];
  progression: string[];
} => {
  // Group notes by time (simplified - would need actual timing)
  const chords: DetectedChord[] = [];
  const progression: string[] = [];

  // For now, analyze all notes together
  const chord = detectChord(notes);
  if (chord) {
    chords.push(chord);
    progression.push(chord.name);
  }

  return { chords, progression };
};
