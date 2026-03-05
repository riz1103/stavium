import { Pitch, NoteDuration } from '../types/music';

/**
 * Converts a pitch string (e.g., "C4", "E#5") to MIDI note number
 */
export const pitchToMidi = (pitch: Pitch): number => {
  const match = pitch.match(/^([A-G])([#bn]?)(\d+)$/);
  if (!match) return 60; // Default to C4

  const [, note, accidental, octave] = match;
  const octaveNum = parseInt(octave, 10);

  // Base MIDI note for C in each octave
  const baseNote = (octaveNum + 1) * 12;

  // Note offsets from C
  const noteOffsets: Record<string, number> = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11,
  };

  let midiNote = baseNote + noteOffsets[note];

  // Apply accidental
  if (accidental === '#') midiNote += 1;
  if (accidental === 'b') midiNote -= 1;
  // 'n' (natural) doesn't change the MIDI note - it's just the base note

  return midiNote;
};

/**
 * Converts MIDI note number to pitch string
 */
export const midiToPitch = (midi: number): Pitch => {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;

  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = noteNames[noteIndex];

  return `${noteName}${octave}` as Pitch;
};

/**
 * Gets the frequency in Hz for a given pitch
 */
export const pitchToFrequency = (pitch: Pitch): number => {
  const midi = pitchToMidi(pitch);
  return 440 * Math.pow(2, (midi - 69) / 12);
};

/**
 * Gets the staff line/space position for a pitch
 * Returns a number where 0 = middle C, positive = above, negative = below
 */
export const pitchToStaffPosition = (pitch: Pitch, clef: 'treble' | 'bass'): number => {
  const midi = pitchToMidi(pitch);
  
  if (clef === 'treble') {
    // Middle C (C4) is MIDI 60, which is one ledger line below treble staff
    // B4 (MIDI 71) is on the top line of treble staff
    return midi - 71;
  } else {
    // Bass clef: C3 (MIDI 48) is two ledger lines below bass staff
    // D3 (MIDI 50) is on the bottom line of bass staff
    return midi - 50;
  }
};

/**
 * Parses a pitch string and returns components
 * Handles formats like "C4", "G#3", "Bb5", "C#4"
 */
export const parsePitch = (pitch: Pitch): { note: string; accidental: string | null; octave: number } => {
  // Match patterns like "C4", "G#3", "Bb5", "C#4", "Ab2", "An4" (natural)
  const match = pitch.match(/^([A-G])([#bn]?)(\d+)$/);
  if (!match) {
    return { note: 'C', accidental: null, octave: 4 };
  }

  const [, note, accidental, octave] = match;
  return {
    note,
    accidental: accidental || null,
    octave: parseInt(octave, 10),
  };
};

/**
 * Converts a pitch to VexFlow key format (e.g., "c/4", "g/3", "b/5")
 * Note: Accidentals are NOT included in the key - they're added as modifiers
 */
export const pitchToVexFlowKey = (pitch: Pitch): string => {
  const { note, octave } = parsePitch(pitch);
  const noteLower = note.toLowerCase();
  // VexFlow keys don't include accidentals - they're added as modifiers
  return `${noteLower}/${octave}`;
};

/**
 * Converts our key signature string to VexFlow format.
 * VexFlow expects: "C", "G", "D", "A", "E", "B", "F#", "F", "Bb", "Eb", "Ab", "Db", "Gb"
 * Our format already matches, but we normalize it.
 */
export const keySignatureToVexFlow = (keySignature: string): string => {
  // Normalize: "B♭" → "Bb", "F♯" → "F#", etc.
  return keySignature
    .replace(/♭/g, 'b')
    .replace(/♯/g, '#')
    .trim();
};

/**
 * Returns which notes are sharp/flat in a given key signature.
 * Returns a Set of note names (without octave) that should be sharp/flat.
 * Example: "G" → Set(["F"]) (F is sharp in G major)
 */
export const getKeySignatureAccidentals = (keySignature: string): {
  sharps: Set<string>;
  flats: Set<string>;
} => {
  const sharps = new Set<string>();
  const flats = new Set<string>();

  const key = keySignature.replace(/♭/g, 'b').replace(/♯/g, '#').trim();

  // Circle of fifths for major keys
  const sharpKeys: Record<string, string[]> = {
    'C': [],
    'G': ['F'],
    'D': ['F', 'C'],
    'A': ['F', 'C', 'G'],
    'E': ['F', 'C', 'G', 'D'],
    'B': ['F', 'C', 'G', 'D', 'A'],
    'F#': ['F', 'C', 'G', 'D', 'A', 'E'],
  };

  const flatKeys: Record<string, string[]> = {
    'F': ['B'],
    'Bb': ['B', 'E'],
    'Eb': ['B', 'E', 'A'],
    'Ab': ['B', 'E', 'A', 'D'],
    'Db': ['B', 'E', 'A', 'D', 'G'],
    'Gb': ['B', 'E', 'A', 'D', 'G', 'C'],
  };

  if (sharpKeys[key]) {
    sharpKeys[key].forEach((n) => sharps.add(n));
  } else if (flatKeys[key]) {
    flatKeys[key].forEach((n) => flats.add(n));
  }

  return { sharps, flats };
};

/**
 * Applies the key signature to a pitch, returning the actual pitch that should be played.
 * If the pitch has no explicit accidental, applies the key signature's accidental.
 * If the pitch has an explicit accidental (including natural), that takes precedence.
 * 
 * Examples:
 * - applyKeySignature("B4", "F") → "Bb4" (F major has B♭)
 * - applyKeySignature("B4", "C") → "B4" (C major has no accidentals)
 * - applyKeySignature("Bb4", "C") → "Bb4" (explicit accidental takes precedence)
 * - applyKeySignature("Bn4", "F") → "B4" (explicit natural overrides key signature)
 */
export const applyKeySignature = (pitch: Pitch, keySignature: string): Pitch => {
  const { note, accidental, octave } = parsePitch(pitch);
  const { sharps, flats } = getKeySignatureAccidentals(keySignature);

  // If pitch has an explicit accidental, use it (including natural)
  if (accidental === 'n') {
    // Explicit natural → remove accidental
    return `${note}${octave}` as Pitch;
  }
  if (accidental === '#' || accidental === 'b') {
    // Explicit sharp or flat → keep it
    return pitch;
  }

  // No explicit accidental → apply key signature
  if (sharps.has(note)) {
    return `${note}#${octave}` as Pitch;
  } else if (flats.has(note)) {
    return `${note}b${octave}` as Pitch;
  }

  // Key signature doesn't affect this note → return as-is (natural)
  return pitch;
};

/**
 * Finds the most recent accidental for a pitch class (note name) in a measure.
 * According to music theory, an accidental applies to all subsequent notes of the
 * same pitch class in the same measure until the barline.
 * 
 * @param measure - The measure to search through
 * @param noteName - The note name (A-G) to find accidentals for
 * @param upToIndex - Search only up to this note index (exclusive)
 * @returns The accidental found ('#', 'b', 'n', or null), or null if none found
 */
export const findMeasureAccidental = (
  measure: { voices: Array<{ notes: Array<{ pitch?: string; accidental?: 'sharp' | 'flat' | 'natural' | null }> }> },
  noteName: string,
  upToIndex: number
): string | null => {
  // Search backwards through all voices in the measure
  for (let voiceIndex = measure.voices.length - 1; voiceIndex >= 0; voiceIndex--) {
    const voice = measure.voices[voiceIndex];
    
    // Search backwards through notes in this voice
    for (let i = Math.min(upToIndex, voice.notes.length) - 1; i >= 0; i--) {
      const element = voice.notes[i];
      
      // Only check notes (not rests)
      if (!('pitch' in element) || !element.pitch) continue;
      
      const { note, accidental } = parsePitch(element.pitch);
      
      // Check if this is the same pitch class (same note name)
      if (note === noteName) {
        // Check for explicit accidental on the note object first
        if (element.accidental === 'sharp') return '#';
        if (element.accidental === 'flat') return 'b';
        if (element.accidental === 'natural') return 'n';
        
        // Otherwise check the pitch string
        if (accidental === '#') return '#';
        if (accidental === 'b') return 'b';
        if (accidental === 'n') return 'n';
        
        // If no accidental found, continue searching (might be earlier in measure)
      }
    }
  }
  
  return null; // No accidental found in this measure
};

/**
 * Applies key signature and measure-level accidentals to a pitch.
 * Measure-level accidentals take precedence over key signature.
 * 
 * @param pitch - The pitch to process
 * @param keySignature - The key signature
 * @param measure - The measure containing the note (for measure-level accidentals)
 * @param noteIndex - The index of the note in the voice (for searching backwards)
 * @returns The actual pitch that should be played
 */
export const applyKeySignatureAndMeasureAccidentals = (
  pitch: Pitch,
  keySignature: string,
  measure: { voices: Array<{ notes: Array<{ pitch?: string; accidental?: 'sharp' | 'flat' | 'natural' | null }> }> },
  noteIndex: number,
  currentNoteAccidental?: 'sharp' | 'flat' | 'natural' | null
): Pitch => {
  const { note, accidental, octave } = parsePitch(pitch);
  
  // Check the current note's explicit accidental field first (takes highest precedence)
  // This handles cases where the accidental is set via the UI
  if (currentNoteAccidental === 'natural') {
    // Explicit natural → return natural pitch (overrides key signature)
    return `${note}${octave}` as Pitch;
  }
  if (currentNoteAccidental === 'sharp') {
    return `${note}#${octave}` as Pitch;
  }
  if (currentNoteAccidental === 'flat') {
    return `${note}b${octave}` as Pitch;
  }
  
  // If pitch string has an explicit accidental, use it (including natural)
  if (accidental === 'n') {
    // Explicit natural → return natural pitch (overrides key signature)
    return `${note}${octave}` as Pitch;
  }
  if (accidental === '#') {
    return pitch;
  }
  if (accidental === 'b') {
    return pitch;
  }
  
  // Check for measure-level accidental (from previous notes in same measure)
  const measureAccidental = findMeasureAccidental(measure, note, noteIndex);
  if (measureAccidental === '#') {
    return `${note}#${octave}` as Pitch;
  }
  if (measureAccidental === 'b') {
    return `${note}b${octave}` as Pitch;
  }
  if (measureAccidental === 'n') {
    // Measure-level natural → return natural pitch (overrides key signature)
    return `${note}${octave}` as Pitch;
  }
  
  // No explicit or measure-level accidental → apply key signature
  return applyKeySignature(pitch, keySignature);
};

/**
 * Determines if a note's accidental should be displayed given the key signature.
 * Returns true if the accidental should be shown (it differs from the key signature).
 * 
 * Rules:
 * - If note has no accidental → don't show (follows key signature)
 * - If note has sharp/flat that matches key → don't show
 * - If note has sharp/flat that differs from key → show
 * - If note has natural but key expects sharp/flat → show natural
 */
export const shouldShowAccidental = (
  pitch: Pitch,
  keySignature: string
): boolean => {
  const { note, accidental } = parsePitch(pitch);
  const { sharps, flats } = getKeySignatureAccidentals(keySignature);

  // No accidental in pitch → follows key signature, don't show
  if (!accidental) {
    return false;
  }

  // Note has an accidental - check if it matches or contradicts the key
  if (accidental === '#') {
    // Note is sharp - show only if key doesn't already make it sharp
    return !sharps.has(note);
  } else if (accidental === 'b') {
    // Note is flat - show only if key doesn't already make it flat
    return !flats.has(note);
  } else if (accidental === 'n') {
    // Natural - show if key signature would make this note sharp or flat
    return sharps.has(note) || flats.has(note);
  }

  return true; // Unknown accidental type, show it
};
