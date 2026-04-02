import { Composition, Staff, Measure, Note, Rest, NoteDuration, Clef } from '../types/music';
import type { VexFlowData, Staff as OMRStaff, Voice as OMRVoice } from '../services/omrService';
import { durationToBeats } from './durationUtils';

/**
 * Convert OMR VexFlow duration string to app NoteDuration
 * OMR format: "w" (whole), "h" (half), "q" (quarter), "8" (eighth)
 */
function convertDuration(omrDuration: string): NoteDuration {
  const durationMap: Record<string, NoteDuration> = {
    'w': 'whole',
    'h': 'half',
    'q': 'quarter',
    '8': 'eighth',
    '16': 'sixteenth',
    '32': 'thirty-second',
  };
  return durationMap[omrDuration] || 'quarter';
}

/**
 * Convert OMR pitch format to app pitch format
 * OMR format: "C/4", "D#/5", "Bb/3"
 * App format: "C4", "D#5", "Bb3"
 */
function convertPitch(omrPitch: string): string {
  // OMR format: "C/4" or "D#/5" or "Bb/3"
  // Remove the slash and convert to app format
  return omrPitch.replace('/', '');
}

/**
 * Convert OMR clef to app Clef type
 */
function convertClef(omrClef: string): Clef {
  const clefMap: Record<string, Clef> = {
    'treble': 'treble',
    'bass': 'bass',
    'alto': 'alto',
  };
  return clefMap[omrClef] || 'treble';
}

/**
 * Parse time signature string (e.g., "4/4") and return numerator and denominator
 */
function parseTimeSignature(timeSig: string): { numerator: number; denominator: number } {
  const parts = timeSig.split('/');
  const numerator = parseInt(parts[0] || '4', 10);
  const denominator = parseInt(parts[1] || '4', 10);
  return { numerator, denominator: denominator || 4 };
}

/**
 * Convert OMR VexFlow data to app Composition format
 */
export function convertOMRVexFlowToComposition(
  omrData: VexFlowData,
  title: string = 'Imported from PDF'
): Composition {
  const staves: Staff[] = omrData.staves.map((omrStaff: OMRStaff, staffIndex: number) => {
    // Convert clef
    const clef = convertClef(omrStaff.clef);
    
    // Determine instrument (default to piano)
    const instrument = 'piano';
    
    // Parse time signature
    const timeSig = parseTimeSignature(omrStaff.timeSignature);
    const beatsPerMeasure = omrData.beatsPerMeasure || timeSig.numerator;
    const beatValue = omrData.beatValue || timeSig.denominator;
    
    // Convert measures from voices
    // OMR format: voices is Voice[][] - array of voice groups, each group is an array of Voice objects
    // Each Voice object represents a note/rest with duration
    // We need to distribute these notes across measures based on the time signature
    
    const measures: Measure[] = [];
    const allNotes: (Note | Rest)[] = [];
    
    // Convert all voices to notes (merge all voice groups into a single sequence)
    // For simplicity, we'll take the first voice group, or merge them sequentially
    if (omrStaff.voices.length > 0) {
      // Use the first voice group, or merge all if multiple exist
      const primaryVoice = omrStaff.voices[0] || [];
      
      primaryVoice.forEach((voiceItem: OMRVoice) => {
        if (voiceItem.keys && voiceItem.keys.length > 0) {
          // It's a note (possibly a chord - we'll take the first key)
          const pitch = convertPitch(voiceItem.keys[0]);
          const duration = convertDuration(voiceItem.duration);
          
          const note: Note = {
            pitch: pitch as any,
            duration,
          };
          
          // If there are multiple keys, it's a chord - we could handle this differently
          // For now, we'll just use the first note
          allNotes.push(note);
        } else {
          // It's a rest
          const duration = convertDuration(voiceItem.duration);
          const rest: Rest = { duration };
          allNotes.push(rest);
        }
      });
    }
    
    // Distribute notes across measures based on time signature
    let currentMeasure: Measure | null = null;
    let currentMeasureBeats = 0;
    let measureNumber = 1;
    
    allNotes.forEach((element) => {
      const elementBeats = durationToBeats(element.duration as NoteDuration);
      
      // Start a new measure if needed
      if (!currentMeasure || currentMeasureBeats + elementBeats > beatsPerMeasure) {
        if (currentMeasure) {
          measures.push(currentMeasure);
          measureNumber++;
        }
        
        currentMeasure = {
          number: measureNumber,
          voices: [{ notes: [] }],
        };
        
        // Set time signature on first measure
        if (measureNumber === 1) {
          currentMeasure.timeSignature = `${beatsPerMeasure}/${beatValue}`;
          if (omrStaff.keySignature) {
            currentMeasure.keySignature = omrStaff.keySignature;
          }
        }
        
        currentMeasureBeats = 0;
      }
      
      // Add element to current measure
      if (currentMeasure) {
        currentMeasure.voices[0].notes.push(element);
        currentMeasureBeats += elementBeats;
      }
    });
    
    // Add the last measure if it exists
    if (currentMeasure) {
      measures.push(currentMeasure);
    }
    
    // Ensure at least one measure exists
    if (measures.length === 0) {
      measures.push({
        number: 1,
        voices: [{ notes: [] }],
        timeSignature: `${beatsPerMeasure}/${beatValue}`,
        keySignature: omrStaff.keySignature,
      });
    }
    
    const staff: Staff = {
      clef,
      instrument,
      measures,
    };
    
    return staff;
  });
  
  // Extract global properties
  const firstStaff = omrData.staves[0];
  const timeSig = parseTimeSignature(firstStaff?.timeSignature || '4/4');
  const globalTimeSig = `${omrData.beatsPerMeasure || timeSig.numerator}/${omrData.beatValue || timeSig.denominator}`;
  const globalKeySig = firstStaff?.keySignature || 'C';
  
  const composition: Composition = {
    title,
    tempo: 120, // Default tempo (OMR doesn't provide this)
    timeSignature: globalTimeSig,
    keySignature: globalKeySig,
    staves: staves.length > 0 ? staves : [{
      clef: 'treble',
      instrument: 'piano',
      measures: [{ number: 1, voices: [{ notes: [] }] }],
    }],
    showMeasureNumbers: true,
    privacy: 'private',
  };
  
  return composition;
}
