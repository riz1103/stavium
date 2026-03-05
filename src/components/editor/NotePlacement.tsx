import { useScoreStore } from '../../app/store/scoreStore';
import { Note } from '../../types/music';
import { pitchToMidi, midiToPitch } from '../../utils/noteUtils';

/**
 * Component for handling note placement on the staff
 * This would typically be integrated into the ScoreEditor
 */
export const useNotePlacement = () => {
  const composition = useScoreStore((state) => state.composition);
  const selectedStaffIndex = useScoreStore((state) => state.selectedStaffIndex ?? 0);
  const selectedMeasureIndex = useScoreStore((state) => state.selectedMeasureIndex ?? 0);
  const selectedVoiceIndex = useScoreStore((state) => state.selectedVoiceIndex);
  const selectedDuration = useScoreStore((state) => state.selectedDuration);
  const addNote = useScoreStore((state) => state.addNote);

  const placeNote = (pitch: string) => {
    if (!composition) return;

    const note: Note = {
      pitch: pitch as any,
      duration: selectedDuration,
    };

    addNote(selectedStaffIndex, selectedMeasureIndex, selectedVoiceIndex, note);
  };

  const placeNoteAtPosition = (x: number, y: number, clef: 'treble' | 'bass') => {
    // Convert click position to pitch
    // This is a simplified version - in production, you'd need more sophisticated
    // logic to map screen coordinates to staff positions
    
    const staffMiddleY = 300; // Approximate middle of staff
    const lineSpacing = 10; // Approximate spacing between staff lines
    const position = Math.round((y - staffMiddleY) / lineSpacing);
    
    // Convert position to MIDI note
    let midiNote: number;
    if (clef === 'treble') {
      midiNote = 71 - position; // B4 is MIDI 71, on top line of treble staff
    } else {
      midiNote = 50 - position; // D3 is MIDI 50, on bottom line of bass staff
    }
    
    // Clamp to valid MIDI range
    midiNote = Math.max(21, Math.min(108, midiNote));
    
    const pitch = midiToPitch(midiNote);
    placeNote(pitch);
  };

  return { placeNote, placeNoteAtPosition };
};
